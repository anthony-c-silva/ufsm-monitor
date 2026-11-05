-- Remove os resultados das sondas simuladas (probe_id sim-*) após o teste.
-- docker exec -i ufsm-timescaledb psql -U ufsm -d monitor < cleanup.sql
DELETE FROM icmp_measurements       WHERE probe_id LIKE 'sim-%';
DELETE FROM dns_measurements        WHERE probe_id LIKE 'sim-%';
DELETE FROM http_measurements       WHERE probe_id LIKE 'sim-%';
DELETE FROM iperf_measurements      WHERE probe_id LIKE 'sim-%';
DELETE FROM traceroute_measurements WHERE probe_id LIKE 'sim-%';
DELETE FROM measurement_runs        WHERE probe_id LIKE 'sim-%';
VACUUM ANALYZE;
