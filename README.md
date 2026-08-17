# Centerfrios Digital Stream

Estou enviando em anexo a imagem oficial da logomarca da CENTERFRIOS.
Instrução de Imagem: Salve a logomarca enviada no diretório `/public/logo.png` e configure o Supabase Storage para armazená-la e exibi-la na aplicação.

Crie uma aplicação web completa, altamente profissional e otimizada de Digital Signage (Mídia Indoor) e Transmissão ao Vivo para a CENTERFRIOS. 
IMPORTANTE: A aplicação DEVE ser 100% compatível com navegadores legados de Smart TVs antigas, especificamente a Philips 43PFG5813/78 (Saphi OS / WebKit antigo), evitando erros de sintaxe JS que causam 'tela branca'.

### 🛠️ CONFIGURAÇÕES CRÍTICAS DE COMPATIBILIDADE (Evitar Tela Branca)
1. Ajuste a build (Vite/React) para suporte a navegadores antigos (ES2015 / ES5 Target). Use o plugin `@vitejs/plugin-legacy` se necessário.
2. Não utilize sintaxes JS ultra-modernas ou bibliotecas de animação pesadas no Player. O Player deve rodar em HTML5 / DOM nativo ultra-leve.
3. Adicione um Error Boundary visual para que, caso ocorra qualquer falha de script, exiba um aviso elegante em vez de uma tela branca.
4. Roteamento: A raiz `/` e a rota `/player` devem carregar o TV Player diretamente. O painel administrativo fica na rota `/admin`.

### 🎨 IDENTIDADE VISUAL CENTERFRIOS
- Logomarca: Exibir a logo anexada no topo do Painel Admin e centralizada na tela do Player.
- Paleta de Cores: Azul Corporativo (#0B4D9C), Amarelo (#FFC700) e Branco (#FFFFFF).
- Fundo do TV Player: Preto Puro (#000000) para transição limpa de vídeos e imagens.
- Tipografia: Sans-Serif encorpada de alta legibilidade a distância (estilo Akko-Bold / Montserrat).
- Slogan Oficial: "CENTERFRIOS — Crescendo com você" (exibir como assinatura na tela de pareamento).

### 🗄️ SUPABASE & BANCO DE DADOS (Realtime & Storage)
1. `tvs`: id, name (ex: "TV Vitrine - Filial Tabuleiro"), pairing_code (6 dígitos), is_paired (boolean), playlist_id (uuid), is_live_active (boolean), live_stream_url (text), last_ping (timestamp).
2. `media`: id, title, url, type ('image' ou 'video'), duration (segundos), file_size, resolution, created_at.
3. `playlists`: id, name, items (jsonb: [{media_id, order, custom_duration}]).

### 📱 PAINEL ADMIN (Rota `/admin` - Mobile e Desktop)
- Design responsivo otimizado para celulares (iOS/Android) e computadores.
- **Gerenciador de Mídias:** Upload de imagens e vídeos MP4 (1080p/4K) no Supabase Storage com barra de progresso.
- **Gerenciador de Playlists:** Organizar mídias por ordem e configurar tempo de permanência de fotos (ex: 10s).
- **Gerenciador de TVs:** Lista de telas com indicador de status em tempo real (Online/Offline), botão para digitar código de 6 dígitos para parear e vínculo de playlists.
- **Transmissão Ao Vivo (Câmera do Celular):**
  - Botão "Iniciar Live no Celular" utilizando a câmera do dispositivo via `MediaDevices.getUserMedia` / WebRTC / Stream HLS.
  - Ao acionar, envia sinal via Supabase Realtime pausando o loop de anúncios das TVs e transmitindo a imagem ao vivo em tela cheia nas Smart TVs.
  - Botão "Encerrar Live" para retomar o loop de mídia automaticamente.

### 📺 TV PLAYER PARA PHILIPS SAPHI OS (Rotas `/` e `/player`)
- **Tela de Pareamento:**
  - Se a TV não possuir identificação no `localStorage`, gera um `pairing_code` aleatório de 6 dígitos.
  - Exibe a Logomarca da Centerfrios, o código gigante em amarelo `#FFC700` e a instrução: "Acesse o painel no celular para ativar esta TV".
  - Ouve eventos Realtime do Supabase. Assim que pareada no Admin, inicia a transmissão.
- **Execução do Loop de Mídia:**
  - Exibe vídeos nativos via `<video autoplay muted playsinline>` com evento `onEnded` para passar para a próxima mídia sem travamento.
  - **Pre-buffering:** Carrega em plano de fundo o próximo vídeo/imagem para zerar o tempo de tela preta entre transições.
  - **Resiliência / Modo Offline:** Salva a playlist no `localStorage` da TV para garantir que, se a internet da loja oscilar, os anúncios continuem rodando.
  - **Modo Transmissão Ao Vivo:** Recebe a Live do celular e exibe em tela cheia na TV quando ativado pelo Admin.

Gere o código completo, modularizado e totalmente funcional, integrado ao Supabase.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://centerfrios-tv.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/73d353fa-005b-4ab7-85db-cbcd1aaaf70e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
