# Botzap CRM (Cloudflare Pages)

Este projeto e um front-end estatico com **Pages Functions** para integrar a WhatsApp Cloud API.

## Estrutura
- `public/index.html`: interface para envio de mensagem e criacao de template.
- `public/privacy.html`: politica de privacidade.
- `functions/api/send-message.ts`: envia mensagem pelo WhatsApp.
- `functions/api/create-template.ts`: cria template na WABA.
- `functions/webhook.ts`: endpoint para verificacao e recebimento de webhooks.

## Variaveis de ambiente (Cloudflare Pages)
Configure em **Settings > Environment variables**:
- `WHATSAPP_TOKEN`: token de acesso da Cloud API.
- `WHATSAPP_PHONE_NUMBER_ID`: Phone Number ID.
- `WHATSAPP_WABA_ID`: WhatsApp Business Account ID.
- `WHATSAPP_API_VERSION`: opcional (default `v19.0`).
- `WHATSAPP_VERIFY_TOKEN`: token escolhido por voce para validar o webhook.

## Webhook (Meta)
No painel do app:
1. Em **WhatsApp > Configuracao**, informe o **URL de callback**:
   - `https://SEU-DOMINIO.pages.dev/webhook`
2. Em **Verificar token**, use exatamente o valor de `WHATSAPP_VERIFY_TOKEN`.
3. Clique em **Verificar e salvar**.

## Teste local (opcional)
Se usar `wrangler pages dev`:
1. Instale o Wrangler.
2. Rode: `wrangler pages dev public --functions ./functions`.
3. Configure as env vars no `.dev.vars`.

## Videos para analise da Meta
1. **whatsapp_business_messaging**
   - Abra o app (pagina inicial).
   - Envie uma mensagem para um numero real.
   - Grave o app enviando e o WhatsApp (web ou celular) recebendo.

2. **whatsapp_business_management**
   - Abra o app.
   - Crie um template.
   - Grave um video separado mostrando a criacao do template.

## Observacoes
- Os endpoints usam POST para: `/api/send-message` e `/api/create-template`.
- O app e simples e focado em demonstrar as permissoes exigidas.