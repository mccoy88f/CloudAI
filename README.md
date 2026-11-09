# CloudAI

Workspace web per progetti locali guidati da CLI di agenti. Il piano di sviluppo è in [PIANO.md](PIANO.md).

## Coolify

1. Crea una risorsa Docker Compose puntata a questo repository, branch `main`, file `docker-compose.yml`.
2. Coolify genera `SERVICE_PASSWORD_POSTGRES` e il dominio `SERVICE_FQDN_WEB_80` (porta interna 80 del servizio `web`).
3. Imposta il dominio dell'interfaccia su un host preciso, per esempio `cloudai.tuodominio.it`. Traefik di Coolify termina il TLS.
4. Avvia il deploy. I volumi `postgres-data`, `workspaces` e `engines` restano tra un deploy e l'altro.

Il browser parla solo con `web`. Nginx inoltra `/api`, compreso il WebSocket `/api/ws`, al servizio `api`, con timeout di un'ora. `api` e `runner` non sono pubblicati.

Al primo accesso l'interfaccia chiede l'amministratore, la GitHub App, la cartella progetti, l'URL pubblico e il dominio delle preview. La chiave della App e il webhook secret restano cifrati con `SERVICE_PASSWORD_APP`. Da quel momento il wizard non si ripresenta. L'amministratore invita gli altri utenti con un link monouso.

Il dominio wildcard delle preview (`*.preview.…`) arriva con la fase dei server locali. Non va messo nel campo dominio di Coolify: Traefik rifiuta `Host(\`*.…\`)`.

## Locale

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

L'interfaccia è su `http://localhost:8080`.
