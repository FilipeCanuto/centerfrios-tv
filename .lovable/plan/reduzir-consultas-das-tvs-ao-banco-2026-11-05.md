# Reduzir consultas das TVs ao banco

## O que muda
1. **Sinal de vida (heartbeat):** 60 s → 120 s no player estático e no player React.
2. **Online/offline no painel:** a TV só aparece offline após 300 s (5 min) sem sinal (vale para TVs, Ao Vivo, Vinhetas, Endomarketing e o contador do topo, que usam a mesma regra).
3. **Player estático:** consulta de estado da TV 20 s → 60 s; consulta de avisos 25 s → 90 s.
4. **Player React:** com o tempo real conectado e saudável, consultas de guarda e de destaque passam a 180 s. Se o tempo real cair, volta aos 30 s atuais até reconectar.

## Ajuste obrigatório para não perder avisos/destaques
Hoje o painel mantém cada aviso/destaque disponível por 35 s além do tempo de tela, porque as TVs consultavam a cada 25-30 s. Com consulta de avisos a cada 90 s, um aviso curto sumiria antes da TV ver. Por isso a janela de entrega sobe de 35 s para **100 s** (painel e player, mesmo valor). A TV continua exibindo só o tempo de tela escolhido.

## Efeitos colaterais (aceitáveis)
- Comandos remotos (recarregar, mudo) e troca de playlist podem levar até 60 s para chegar ao player estático (antes, 20 s).
- A entrada no modo Endomarketing pode levar até 60 s; durante o modo, o acompanhamento rápido (2 s) continua igual.
- O aviso de "TV parada há mais de 10 min" continua igual.

## Intocado
Reprodução YouTube/MP4, double buffer, cache local, barra de informações, transições, applyLayout, pareamento e áudio.

## Detalhes técnicos
- `public/player-engine.js`: `POLL_MS=60000`, `HEARTBEAT_MS=120000`, `ALERT_MS=90000`, `DELIVERY_GRACE_MS=100000` (sintaxe ES5); atualizar `?v=` em `public/player.html`.
- `src/lib/centerfrios.ts`: `isOnline` limite 300000; `DELIVERY_GRACE_MS=100000`.
- `src/components/TvPlayer.tsx`: `HEARTBEAT_MS=120000`; guardar status do canal (`subscribe(status => ...)`) e escolher 180000 quando `SUBSCRIBED`, senão 30000, para guarda e destaque (reagendar o intervalo quando o status mudar).
