## Objetivo

Evoluir o Centerfrios Mídia Indoor para player React moderno (Fire TV / Chromecast / Android Chromium), gestão completa pelo celular e mural interativo de eventos.

Estado atual verificado: existem as tabelas `tvs`, `media`, `playlists`, `live_frames`; o admin usa abas TVs/Mídias/Playlists/Ao Vivo; `MediaManager` envia **um arquivo por vez**; `TvPlayer.tsx` não tem cache offline, crossfade, multi-zona nem comandos remotos. Nada disso existe hoje — será criado.

---

## 1. Banco de dados (uma migração)

- `tvs`: novas colunas `orientation` ('landscape' | 'portrait'), `layout_mode` ('fullscreen' | 'multizone'), `muted` (bool), `ticker_text`, `qr_url`, `screen_resolution`, `memory_usage`, `command` (jsonb: `{action, nonce, payload}`), `event_mode` (bool).
- Nova tabela `event_photos`: `id`, `image_url`, `storage_path`, `status` ('pending' | 'approved' | 'rejected'), `featured` (bool), `device_hash`, `created_at`.
- Nova tabela `tv_alerts`: `id`, `message`, `expires_at`, `created_at` (pop-up VIP).
- GRANTs + RLS: leitura pública restrita (colunas seguras já usadas hoje), inserção anônima em `event_photos` apenas com status `pending`, escrita/moderação apenas para autenticados.
- Rate-limit de 3 uploads / 5 min por dispositivo: função `submit_event_photo` (security definer) que conta envios recentes por `device_hash` e recusa o excedente.
- Realtime habilitado em `tvs`, `event_photos`, `tv_alerts`.
- Bucket `event-photos` (privado, URLs assinadas), seguindo o padrão do bucket `media`.

## 2. Design system e layout do /admin

- Container único em todas as abas: `max-w-7xl mx-auto px-4 sm:px-6 py-6`; nenhum componente define largura/escala própria.
- Paleta mantida/ajustada em `src/styles.css` (#0A3981, #1E56A0, #FFC700, #F8FAFC).
- Abas: TVs | Playlists | Mídias | Ao Vivo | Eventos, com indicador ativo e badge numérico (contagem de TVs online, itens, mídias, fotos pendentes).

## 3. Mídias — upload em massa

- `<input multiple>`; fila de upload com item por arquivo: miniatura, progresso individual, status (aguardando/enviando/ok/erro) e retry.
- Metadados automáticos já existentes (tamanho, resolução, formato) aplicados por arquivo.
- Busca por nome + filtro rápido Todas | Vídeos | Imagens.

## 4. Construtor de playlists

- Drag & drop de reordenação (`@dnd-kit/core` + `@dnd-kit/sortable`).
- Duração individual por item (segundos) com presets 5/10/30.
- Duração total calculada ("3 min e 45 seg").
- Modal de pré-visualização executando a playlist simulada.

## 5. Controle remoto das TVs

Cada card ganha: status Online/Offline com último ping, resolução e memória reportadas pelo player; seletor de layout (Tela Cheia / Multi-Zona); seletor de orientação (16:9 / 9:16); botões Reiniciar Player, Mute/Som e Forçar Sincronização. Comandos gravados em `tvs.command` com `nonce` e entregues via Realtime (o player executa e ignora nonces repetidos).

## 6. Player React `/player` (e `/`)

- **Offline-first**: manifesto da playlist no IndexedDB e binários no Cache API; ao perder rede continua o loop com o conteúdo em cache.
- **Crossfade** por CSS transitions (sem lib pesada), com duas camadas alternadas.
- **Multi-zona**: zona principal (vídeo/imagem), rodapé com ticker rolante (`ticker_text`) e canto superior com logo + QR code dinâmico (`qr_url`).
- **Orientação** vertical via rotação/estilo.
- **Comandos**: reload, mute, sync, troca de layout/orientação aplicados em tempo real; reporta resolução e uso de memória (`performance.memory` quando disponível) no heartbeat.
- **GC e auto-reload**: liberação de `src`/objectURLs a cada ciclo e reload preventivo diário às 03:00.
- **Modo Evento**: fotos aprovadas entram no loop; foto "em destaque" e alertas VIP interrompem imediatamente.
- `public/tv.html` permanece como fallback legado, sem alterações.

## 7. Mural de eventos

- Rota pública `/enviar`: interface mobile enxuta, câmera/galeria, compressão em canvas até ~1.5MB antes do envio, feedback de sucesso e mensagem clara ao atingir o rate-limit.
- Aba **Eventos** no admin: toggle de moderação, grade de fotos com Aprovar / Rejeitar / Exibir Agora em Destaque, e botão de **Alerta VIP** que dispara pop-up imediato em todas as TVs.

## Detalhes técnicos

- Novas dependências: `@dnd-kit/core`, `@dnd-kit/sortable`, `browser-image-compression` (ou compressão manual via canvas), `qrcode`.
- Tipos e helpers centralizados em `src/lib/centerfrios.ts`; novos componentes em `src/components/admin/` (`EventsManager`, `UploadQueue`, `TvControlCard`) e `src/lib/player-cache.ts`.
- `/enviar` é rota pública com `head()` próprio; `/admin` continua sob `_authenticated`.
- Ordem de execução: migração → tipos/helpers → admin → player → rota pública.
