package measure

import (
	"context"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// SysinfoResult e o bloco "result" do inventario local (spec 4.1/6.6).
type SysinfoResult struct {
	Hostname       string            `json:"hostname"`
	AgentVersion   string            `json:"agent_version"`
	OS             string            `json:"os"`
	Arch           string            `json:"arch"`
	ToolVersions   map[string]string `json:"tool_versions"`
	IPAddress      string            `json:"ip_address"`
	Interface      string            `json:"interface"`
	MACAddress     string            `json:"mac_address"`
	Gateway        string            `json:"gateway"`
	DNSResolvers   []string          `json:"dns_resolvers"`
	CPUCount       int               `json:"cpu_count"`
	LoadAvg        []float64         `json:"load_avg"`
	MemTotalKB     int64             `json:"mem_total_kb"`
	MemAvailableKB int64             `json:"mem_available_kb"`
	DiskTotalBytes int64             `json:"disk_total_bytes"`
	DiskFreeBytes  int64             `json:"disk_free_bytes"`
	TimeSync       string            `json:"time_sync"`
	Deployment     string            `json:"deployment,omitempty"`
	VLAN           string            `json:"vlan,omitempty"`
}

// Sysinfo coleta o inventario do probe. Nenhum campo e fatal: em erro fica vazio.
func Sysinfo(_ context.Context, deployment, vlan string) Result {
	hostname, _ := os.Hostname()
	ip, iface, mac := primaryNet()
	memTotal, memAvail := meminfo()
	diskTotal, diskFree := diskUsage("/")

	res := &SysinfoResult{
		Hostname:     hostname,
		AgentVersion: AgentVersion,
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		ToolVersions: map[string]string{
			"fping":  toolVersion("fping", "-v"),
			"iperf3": toolVersion("iperf3", "--version"),
			"dig":    toolVersion("dig", "-v"),
			"curl":   toolVersion("curl", "--version"),
			"mtr":    toolVersion("mtr", "--version"),
		},
		IPAddress:      ip,
		Interface:      iface,
		MACAddress:     mac,
		Gateway:        defaultGateway(),
		DNSResolvers:   dnsResolvers(),
		CPUCount:       runtime.NumCPU(),
		LoadAvg:        loadavg(),
		MemTotalKB:     memTotal,
		MemAvailableKB: memAvail,
		DiskTotalBytes: diskTotal,
		DiskFreeBytes:  diskFree,
		TimeSync:       timeSynced(),
		Deployment:     deployment,
		VLAN:           vlan,
	}
	return resOK(res, nil)
}

func primaryNet() (ip, iface, mac string) {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "", "", ""
	}
	defer conn.Close()
	ip = conn.LocalAddr().(*net.UDPAddr).IP.String()

	ifaces, err := net.Interfaces()
	if err != nil {
		return ip, "", ""
	}
	for _, i := range ifaces {
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			var ipn net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ipn = v.IP
			case *net.IPAddr:
				ipn = v.IP
			}
			if ipn != nil && ipn.String() == ip {
				return ip, i.Name, i.HardwareAddr.String()
			}
		}
	}
	return ip, "", ""
}

func defaultGateway() string {
	data, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 || fields[0] == "Iface" {
			continue
		}
		if fields[1] == "00000000" && fields[2] != "00000000" {
			return hexIPLittleEndian(fields[2])
		}
	}
	return ""
}

func hexIPLittleEndian(h string) string {
	b, err := hex.DecodeString(h)
	if err != nil || len(b) != 4 {
		return ""
	}
	return fmt.Sprintf("%d.%d.%d.%d", b[3], b[2], b[1], b[0])
}

func dnsResolvers() []string {
	data, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return nil
	}
	var out []string
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) >= 2 && fields[0] == "nameserver" {
			out = append(out, fields[1])
		}
	}
	return out
}

func meminfo() (totalKB, availKB int64) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		v, _ := strconv.ParseInt(fields[1], 10, 64)
		switch fields[0] {
		case "MemTotal:":
			totalKB = v
		case "MemAvailable:":
			availKB = v
		}
	}
	return totalKB, availKB
}

func diskUsage(path string) (total, free int64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0
	}
	return int64(st.Blocks) * int64(st.Bsize), int64(st.Bavail) * int64(st.Bsize)
}

func loadavg() []float64 {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return nil
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return nil
	}
	out := make([]float64, 0, 3)
	for i := 0; i < 3; i++ {
		v, _ := strconv.ParseFloat(fields[i], 64)
		out = append(out, v)
	}
	return out
}

func timeSynced() string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "timedatectl", "show", "-p", "NTPSynchronized", "--value").Output()
	if err != nil {
		return "unknown"
	}
	switch strings.TrimSpace(string(out)) {
	case "yes":
		return "synchronized"
	case "no":
		return "not_synchronized"
	default:
		return "unknown"
	}
}

func toolVersion(name string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err != nil && len(out) == 0 {
		return ""
	}
	return strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0]
}
