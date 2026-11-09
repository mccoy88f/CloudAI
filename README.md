# CloudAI

Workspace web per progetti locali guidati da CLI di agenti. Il piano di sviluppo è in [PIANO.md](PIANO.md).

## Coolify

1. Crea una risorsa Docker Compose puntata a questo repository, branch `main`, file `docker-compose.yml`.
2. Coolify genera `SERVICE_PASSWORD_POSTGRES` e il dominio `SERVICE_FQDN_WEB_80` (porta interna 80 del servizio `web`).
3. Imposta il dominio dell'interfaccia su un host preciso, per esempio `cloudai.tuodominio.it`. Traefik di Coolify termina il TLS.
4. Avvia il deploy. I volumi `postgres-data`, `workspaces` e `engines` restano tra un deploy e l'altro.

Il browser parla solo con `web`. Nginx inoltra `/api`, compreso il WebSocket `/api/ws`, al servizio `api`, con timeout di un'ora. `api` e `runner` non sono pubblicati.

Al primo accesso l'interfaccia chiede l'amministratore, la GitHub App, la cartella progetti, l'URL pubblico e il dominio delle preview. La chiave della App e il webhook secret restano cifrati con `SERVICE_PASSWORD_APP`. Da quel momento il wizard non si ripresenta. L'amministratore invita gli altri utenti con un link monouso.

La GitHub App serve anche per i repository privati. Va installata sul repository (o sull'organizzazione, con accesso ai repo privati) e deve poter leggere e scrivere i Contents e aprire le Pull request. Metadata in lettura basta. In creazione progetto si indica `owner/repo`, oppure solo il nome se l'organizzazione è quella del wizard. Il commit resta a nome dell'utente CloudAI. Push e pull request li esegue la App: il token di installazione non finisce nell'URL del remote.

Il dominio delle preview è quello del wizard, senza schema e senza asterisco, per esempio `preview.tuodominio.it`. Imposta la stessa stringa nella variabile `PREVIEW_DOMAIN` prima del deploy. Il compose aggiunge sul runner un solo router `HostRegexp`, entrypoint `https`, certresolver `letsencrypt`. Non mettere `*.preview.…` nel campo dominio di Coolify: Traefik rifiuta `Host(\`*.…\`)`. Il DNS del wildcard deve puntare al server. Un host sconosciuto riceve 404 dal runner.

`SERVICE_PASSWORD_APP` va impostata prima del primo avvio e non va più cambiata: cifra i segreti. `SERVICE_PASSWORD_POSTGRES` la genera Coolify.

## Locale

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

L'interfaccia è su `http://localhost:8080`.
