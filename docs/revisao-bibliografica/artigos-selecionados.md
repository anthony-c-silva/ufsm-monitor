# Revisão Bibliográfica — 10 artigos selecionados

**TCC:** Plataforma Distribuída de Monitoramento Ativo da Rede da UFSM
**Aluno:** Anthony Carlos Da Silva · **Orientador:** Prof. Carlos Raniery

Seleção inicial de 10 trabalhos sobre **plataformas de medição e monitoramento ativo de redes**,
para compor o referencial teórico e os trabalhos relacionados. A seleção prioriza trabalhos **muito
citados** ou **recentes (2020+)**, cobrindo plataformas distribuídas por probes, medição em redes sem
fio e em redes celulares. Links para acesso — baixar preferencialmente pela **rede da UFSM**.

> Conferir a citação completa (autores, páginas, DOI) de cada um no Google Acadêmico ao baixar;
> os itens marcados com "(conferir)" ainda estão a validar.

---

## A. Surveys / fundamentação (base do Capítulo 2)

**1. A Survey on Internet Performance Measurement Platforms and Related Standardization Efforts**
Vaibhav Bajpai, Jürgen Schönwälder — _IEEE Communications Surveys & Tutorials_, 17(3), 2015.
🔗 https://ieeexplore.ieee.org/document/7076582/ · PDF: https://vaibhavbajpai.com/documents/papers/proceedings/lsmp-comst-2015.pdf
_Anotação:_ levanta e classifica as principais plataformas de medição de desempenho da Internet,
comparando cobertura, escala, métricas coletadas e arquitetura, além de discutir os esforços de
padronização. Serve de mapa geral do domínio para situar a plataforma proposta entre as existentes.

**2. A Comprehensive Survey of Recent Internet Measurement Techniques for Cyber Security**
(autores a conferir) — _Computers & Security_, 2023.
🔗 https://dl.acm.org/doi/10.1016/j.cose.2023.103123
_Anotação:_ revisão recente das técnicas de medição da Internet, útil para atualizar o panorama
pós-2020 e mostrar que o tema segue ativo na literatura.

## B. Plataformas de medição distribuída por probes

**3. perfSONAR: A Service Oriented Architecture for Multi-domain Network Monitoring**
Andreas Hanemann et al. — _ICSOC 2005_ (Springer LNCS).
🔗 https://link.springer.com/chapter/10.1007/11596141_19 · PDF: https://www.es.net/assets/pubs_presos/hbbd05.pdf
_Anotação:_ propõe uma arquitetura orientada a serviços para monitoramento de redes entre múltiplos
domínios, com pontos de medição distribuídos que trocam dados de desempenho de forma padronizada.
É uma referência conceitual clássica de medição federada, próxima da separação controlador/probes


**4. Lessons Learned From Using the RIPE Atlas Platform for Measurement Research**
Vaibhav Bajpai, Steffie Jacob Eravuchira, Jürgen Schönwälder — _ACM SIGCOMM CCR_, 45(3), 2015.
🔗 https://dl.acm.org/doi/10.1145/2805789.2805796
_Anotação:_ descreve o RIPE Atlas — rede global de milhares de probes que executam ping, traceroute
e DNS — e relata boas práticas e limitações ao conduzir experimentos com probes distribuídos. É a
plataforma mais próxima da proposta neste trabalho, o que a torna comparação central.

**5. Quantifying Interference between Measurements on the RIPE Atlas Platform**
(Holterbach et al. — conferir) — _ACM IMC 2015_.
🔗 https://dl.acm.org/doi/10.1145/2815675.2815710
_Anotação:_ mostra que medições concorrentes num mesmo conjunto de probes podem interferir umas nas
outras e quantifica esse efeito. Sustenta a decisão de controlar a concorrência e serializar os
testes intrusivos de vazão (iperf3) na plataforma proposta.

**6. Archipelago (Ark) — Infraestrutura de Medição Ativa (CAIDA)**
CAIDA (kc claffy et al.) — infraestrutura em operação desde 2007.
🔗 https://www.caida.org/projects/ark/ · https://www.caida.org/projects/ark/impact/
_Anotação:_ infraestrutura de medição ativa que opera monitores distribuídos, muitos deles em
Raspberry Pi, para coleta contínua de topologia e desempenho da Internet. O uso de Raspberry Pi
como probe é a mesma abordagem adotada na plataforma proposta.

**7. M-Lab: User Initiated Internet Data for the Research Community**
Phillipa Gill, Christophe Diot, Lai Yi Ohlsen, Matt Mathis, Stephen Soltesz — _ACM SIGCOMM CCR_, 52(1), 2022.
🔗 https://dl.acm.org/doi/10.1145/3523230.3523236 · PDF: https://people.cs.umass.edu/~phillipa/papers/MLab_CCR.pdf
_Anotação:_ apresenta uma plataforma aberta e distribuída de medição iniciada pelo usuário,
detalhando a arquitetura de coleta, armazenamento e disponibilização pública dos dados. Visão
recente (2022) usada como comparação de arquitetura e de estratégia de consolidação de dados.

## C. Redes móveis / celulares

**8. Experience: An Open Platform for Experimentation with Commercial Mobile Broadband Networks (MONROE)**
Özgü Alay et al. — _ACM MobiCom 2017_ (versão estendida em _Computer Communications_, 2018).
🔗 https://www.researchgate.net/publication/320219361_Experience_An_Open_Platform_for_Experimentation_with_Commercial_Mobile_Broadband_Networks
Versão periódico: https://www.sciencedirect.com/science/article/abs/pii/S0140366417312860
_Anotação:_ descreve uma plataforma aberta para experimentação e medição em redes móveis de banda
larga comerciais, com nós distribuídos, inclusive em movimento. Mostra como a medição ativa se
aplica a redes celulares e quais métricas surgem nesse contexto.

## D. Redes sem fio (WiFi)

**9. Tools and Techniques for Measurement of IEEE 802.11 Wireless Networks**
(Yeo, Youssef, Agrawala — conferir).
🔗 http://web.cs.wpi.edu/~claypool/papers/tools/paper.pdf
_Anotação:_ reúne ferramentas e técnicas para medir redes sem fio 802.11 e discute as métricas
específicas desse ambiente. Amplia o escopo para o contexto de redes sem fio, além da rede cabeada.

## E. Medição a partir de dentro da rede / banda larga

**10. Measuring Home Broadband Performance**
Srikanth Sundaresan, Walter de Donato, Nick Feamster, Renata Teixeira, Sam Crawford, Antonio Pescapè — _ACM SIGCOMM 2011_.
🔗 https://www.researchgate.net/publication/255960103_Measuring_Home_Broadband_Performance
_Anotação:_ mede o desempenho de banda larga diretamente de dentro da rede, a partir de equipamentos
instalados nos roteadores domésticos, em vez de depender de servidores externos. Reforça o argumento
de medir internamente à infraestrutura — a mesma ideia da plataforma proposta, com probes distribuídos
pelo campus.

---

## Notas para baixar e refinar

- Baixar pela **rede da UFSM** (periódicos pagos). O **Tailscale** facilita acessar remotamente uma
  máquina dentro do laboratório para conseguir os PDFs.
- No **Google Acadêmico**, confirmar a citação de cada título e usar o botão de PDF. Filtrar por
  **"desde 2020"** (recentes) ou ordenar por **número de citações** (mais citados).
- Seguir as **referências** e o **"citado por"** de cada artigo para expandir a revisão.
- Candidatos extras, para passar de 10: _Portolan_ (medição móvel colaborativa), _SmokePing_,
  e a versão original do M-Lab (Dovrolis et al., 2010).
