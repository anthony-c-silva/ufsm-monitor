# Revisão Bibliográfica — 10 artigos selecionados

**TCC:** Plataforma Distribuída de Monitoramento Ativo da Rede da UFSM
**Aluno:** Anthony Carlos Da Silva · **Orientador:** Prof. Carlos Raniery

Seleção inicial de 10 trabalhos sobre **plataformas de medição/monitoramento ativo de rede**,
seguindo os critérios da orientação: incluir RIPE Atlas e perfSONAR, ferramentas para **redes
sem fio** e **redes celulares**, plataformas semelhantes, priorizando trabalhos **muito citados**
ou **recentes (2020+)**. Links para os artigos abaixo — baixar preferencialmente pela **rede da
UFSM** (acesso a periódicos pagos).

> Observação: confirme a citação completa (autores, páginas, DOI) de cada um no **Google Acadêmico**
> ao baixar. Alguns detalhes abaixo estão marcados como "(confirmar)".

---

## A. Surveys / fundamentação (base do Capítulo 2)

**1. A Survey on Internet Performance Measurement Platforms and Related Standardization Efforts**
Vaibhav Bajpai, Jürgen Schönwälder — *IEEE Communications Surveys & Tutorials*, 17(3), 2015.
🔗 https://ieeexplore.ieee.org/document/7076582/ · PDF: https://vaibhavbajpai.com/documents/papers/proceedings/lsmp-comst-2015.pdf
*Por que:* survey de referência — taxonomia das plataformas de medição (RIPE Atlas, perfSONAR,
Ark, M-Lab, SamKnows...), cobertura, escala, métricas e arquitetura. É a espinha dorsal do seu
referencial teórico. Muito citado.

**2. A Comprehensive Survey of Recent Internet Measurement Techniques for Cyber Security**
(autores a confirmar) — *Computers & Security*, 2023.
🔗 https://dl.acm.org/doi/10.1016/j.cose.2023.103123
*Por que:* survey **recente (2023)** de técnicas de medição da Internet — cumpre o critério de
"trabalhos atuais" e traz o panorama pós-2020.

## B. Plataformas de medição distribuída por probes (o núcleo do seu trabalho)

**3. perfSONAR: A Service Oriented Architecture for Multi-domain Network Monitoring**
Andreas Hanemann et al. — *ICSOC 2005* (Springer LNCS).
🔗 https://link.springer.com/chapter/10.1007/11596141_19 · PDF: https://www.es.net/assets/pubs_presos/hbbd05.pdf
*Por que:* o perfSONAR que o professor citou — arquitetura orientada a serviços, medição
multi-domínio, pontos de medição distribuídos. Base conceitual clássica.

**4. Lessons Learned From Using the RIPE Atlas Platform for Measurement Research**
Vaibhav Bajpai, Steffie Jacob Eravuchira, Jürgen Schönwälder — *ACM SIGCOMM CCR*, 45(3), 2015.
🔗 https://dl.acm.org/doi/10.1145/2805789.2805796
*Por que:* o RIPE Atlas que o professor citou — probes distribuídos executando ping, traceroute,
DNS. É a plataforma mais parecida com a sua; lições de uso direto para o seu trabalho.

**5. Quantifying Interference between Measurements on the RIPE Atlas Platform**
(Holterbach et al. — confirmar) — *ACM IMC 2015*.
🔗 https://dl.acm.org/doi/10.1145/2815675.2815710
*Por que:* trata da **interferência entre medições** numa plataforma de probes — embasa diretamente
o seu **controle de concorrência / serialização do iperf3** (medições intrusivas).

**6. Archipelago (Ark) Measurement Infrastructure — CAIDA**
CAIDA (kc claffy et al.) — infraestrutura ativa em operação desde 2007.
🔗 https://www.caida.org/projects/ark/ · Impacto: https://www.caida.org/projects/ark/impact/
*Por que:* plataforma de medição ativa que **usa Raspberry Pi** como monitores distribuídos —
paralelo direto com a sua arquitetura de probes. (Infra com várias publicações CAIDA associadas.)

**7. M-Lab: User Initiated Internet Data for the Research Community**
Phillipa Gill, Christophe Diot, Lai Yi Ohlsen, Matt Mathis, Stephen Soltesz — *ACM SIGCOMM CCR*, 52(1), 2022.
🔗 https://dl.acm.org/doi/10.1145/3523230.3523236 · PDF: https://people.cs.umass.edu/~phillipa/papers/MLab_CCR.pdf
*Por que:* plataforma **aberta e distribuída** de medição — visão **recente (2022)** de arquitetura,
coleta e disponibilização de dados. Ótimo comparativo.

## C. Redes móveis / celulares (pedido do orientador)

**8. Experience: An Open Platform for Experimentation with Commercial Mobile Broadband Networks (MONROE)**
Özgü Alay et al. — *ACM MobiCom 2017* (versão estendida em *Computer Communications*, 2018).
🔗 https://www.researchgate.net/publication/320219361_Experience_An_Open_Platform_for_Experimentation_with_Commercial_Mobile_Broadband_Networks
Versão periódico: https://www.sciencedirect.com/science/article/abs/pii/S0140366417312860
*Por que:* plataforma de medição em **redes móveis/celulares** comerciais, com nós distribuídos
(inclusive em movimento) — exatamente o "redes de telefonia celular" que o professor sugeriu.

## D. Redes sem fio / WiFi (pedido do orientador)

**9. Tools and Techniques for Measurement of IEEE 802.11 Wireless Networks**
(Yeo, Youssef, Agrawala — confirmar) — medição de redes 802.11.
🔗 http://web.cs.wpi.edu/~claypool/papers/tools/paper.pdf
*Por que:* medição/monitoramento de **redes sem fio (WiFi)** e as métricas próprias desse contexto —
cobre o pedido de ferramentas para redes sem fio.

## E. Medição a partir de dentro da rede / banda larga

**10. Measuring Home Broadband Performance**
Srikanth Sundaresan, Walter de Donato, Nick Feamster, Renata Teixeira, Sam Crawford, Antonio Pescapè — *ACM SIGCOMM 2011* (programa SamKnows / FCC "Measuring Broadband America").
🔗 https://www.researchgate.net/publication/255960103_Measuring_Home_Broadband_Performance
*Por que:* mede desempenho **direto de dentro da rede** (whiteboxes nos roteadores) — mesma ideia dos
seus probes medindo internamente. Muito citado; base para "medir internamente vs. depender de terceiros".

---

## Dicas para baixar e refinar

- **Acesso:** use a **rede da UFSM** (o professor desaconselhou VPN doméstica). O **Tailscale** que ele
  citou ajuda a acessar remotamente uma máquina dentro do laboratório.
- **Google Acadêmico:** abra cada título lá, confirme a citação e prefira o botão de PDF. Filtre por
  **"desde 2020"** (recentes) ou ordene por **nº de citações** (muito citados).
- **Bola de neve:** dentro de cada artigo, veja as **referências** e o **"citado por"** — é assim que a
  revisão cresce (fulano citou ciclano...).
- **Extras** (se quiser passar de 10): *Portolan* (medição móvel colaborativa), *SmokePing*, *Netrounds/
  Hawkeye* (plataformas comerciais de medição ativa) e a versão original do M-Lab (Dovrolis et al., 2010).
