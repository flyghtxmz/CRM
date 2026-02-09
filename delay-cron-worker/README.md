# Botzap Delay Cron Worker

Este worker roda o processamento de delays de forma autonoma, sem depender de tela aberta.

## 1) Variaveis no CRM (Pages)

No projeto CRM (Pages), adicione:

- `BOTZAP_CRON_SECRET` (Secret)
  - Gere um valor forte e aleatorio.

## 2) Endpoint usado

O worker chama:

- `POST /api/process-delays?limit=50`
- Header: `x-cron-secret: <BOTZAP_CRON_SECRET>`

## 3) Variaveis no Worker

No worker `botzap-delay-cron`, configure:

- `CRM_BASE_URL` (Text): ex. `https://crm-e5k.pages.dev`
- `CRM_CRON_SECRET` (Secret): mesmo valor de `BOTZAP_CRON_SECRET`

## 4) Agendamento

No `wrangler.toml`:

- `*/1 * * * *` (a cada 1 minuto)

Se quiser menor latencia, ajuste para frequencia maior dentro do que seu plano permitir.

## 5) Teste manual

No navegador, acesse:

- `https://<worker-domain>/run`

Resposta esperada:

- JSON com `ok: true` no endpoint do CRM.

