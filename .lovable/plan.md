## Objetivo

Aplicação de mídia indoor para a CENTERFRIOS: TVs Philips Saphi rodam um player ultra-leve em `/` e `/player`, e o painel `/admin` (protegido por login) gerencia mídias, playlists, TVs e a transmissão ao vivo pela câmera do celular.

## Identidade visual

- Azul `#0B4D9C`, Amarelo `#FFC700`, Branco, fundo do player Preto puro.
- Montserrat (peso 700/800) carregada via `<link>` no root.
- Logomarca enviada publicada no Storage e também disponível em `/logo.png`; aparece no topo do Admin e centralizada no player/pareamento.
- Slogan "CENTERFRIOS — Crescendo com você" na tela de pareamento.

## Compatibilidade com a Philips 43PFG5813 (Saphi / WebKit antigo)

- Build com target ES2015 e `@vitejs/plugin-legacy` para gerar bundle com polyfills.
- Player escrito em DOM/HTML5 simples: `<img>` e `<video autoplay muted playsinline>`, sem animações pesadas nem APIs modernas (sem optional chaining no código emitido, sem `IntersectionObserver`, etc.).
- Error Boundary visual em toda a árvore: em caso de falha de script exibe aviso azul/amarelo com logo em vez de tela branca.
- Rotas `/` e `/player` carregam o player diretamente.

## Backend (Lovable Cloud)

Tabelas:
- `tvs`: id, name, pairing_code (6 dígitos), is_paired, playlist_id, is_live_active, live_stream_url, last_ping, created_at.
- `media`: id, title, url, type ('image' | 'video'), duration, file_size, resolution, created_at.
- `playlists`: id, name, items (jsonb `[{media_id, order, custom_duration}]`), created_at.
- `live_frames`: id, tv_id/global, image_data, created_at — usada pelo modo live por snapshots.
- `user_roles` + `has_role()` para o acesso administrativo.

Políticas: leitura anônima apenas do necessário para a TV (a TV não faz login) restrita por `pairing_code`/id; escrita apenas para usuários autenticados. Grants explícitos por tabela. Realtime habilitado em `tvs` e `live_frames`.

Storage: bucket público `media` para vídeos/imagens e a logomarca.

## Painel Admin (`/admin`, protegido)

- Login por e-mail e senha em `/auth`; `/admin` sob rota autenticada.
- Header com logomarca; layout responsivo (mobile-first) com abas: Mídias, Playlists, TVs, Live.
- **Mídias:** upload de imagem e MP4 direto ao Storage com barra de progresso, leitura automática de duração/resolução, preview e exclusão.
- **Playlists:** criar/renomear, adicionar mídias, reordenar (subir/descer) e definir tempo de exibição por foto (padrão 10s).
- **TVs:** lista com status Online/Offline por `last_ping`, campo para digitar o código de 6 dígitos e parear, renomear a TV e vincular playlist.
- **Live:** botão "Iniciar Live no Celular" (`getUserMedia`, câmera traseira), captura frames em ~1–2 fps para um canvas, envia JPEG comprimido ao Cloud e marca `is_live_active` nas TVs selecionadas; botão "Encerrar Live" retoma o loop.

## TV Player (`/` e `/player`)

- Sem identificação no `localStorage`: gera código de 6 dígitos, registra a TV e exibe tela de pareamento (logo, código gigante em amarelo, instrução e slogan).
- Escuta Realtime; ao ser pareada, inicia o loop imediatamente.
- Loop: imagens pelo tempo configurado, vídeos com `onEnded`; pre-buffer do próximo item em elemento oculto para transição sem tela preta.
- Resiliência: playlist e URLs salvas no `localStorage`; se a rede cair, continua rodando o último conteúdo conhecido e reconecta sozinho.
- Ping periódico de `last_ping` para o status Online no Admin.
- Modo live: ao receber `is_live_active`, pausa o loop e exibe os frames da câmera em tela cheia; ao encerrar, volta ao loop.

## Detalhes técnicos

- Stack fixa: TanStack Start + TanStack Router (rotas em `src/routes/`), Tailwind v4 com tokens em `src/styles.css`.
- Uploads e leituras da TV usam o cliente Supabase do browser; ações administrativas sensíveis passam por server functions autenticadas.
- Logomarca hospedada via Lovable Assets + cópia em `public/logo.png` e no bucket do Storage.
- Metadados `head()` próprios por rota; `/player` com `noindex`.

## Observação

A live por snapshots (~1–2 fps, sem áudio) é a única forma confiável em Saphi antigo. Se depois quiser vídeo fluido com áudio, dá para adicionar suporte a uma URL HLS externa como alternativa no mesmo painel.
