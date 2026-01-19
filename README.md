# Smart notes application!

1.INTRO

This is a docker compose enviroment, for the app creating smart notes locally.

2.ENVIROMENT

Before you do anything you NEED to edit these lines of the docker-compose.yml:
```
- DB_PASSWORD=<DATABASE_USER_PASSWORD>

- MARIADB_ROOT_PASSWORD=<ROOT_PASSWORD>

- MARIADB_PASSWORD=<DATABASE_USER_PASSWORD>
```
Make sure you fill it with your own credentials.

3. CERTIFICATES

You need to install openssl and generate CA certificates for the nginx reverse-proxy server:
``` 
mkdir certs && cd certs && openssl req -x509 -newkey rsa:2048 -sha256 -days 365 \
  -nodes \
  -keyout localhost.key \
  -out localhost.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

4. COMPOSING DOCKER CONTAINERS

To run the project you only need to have docker installed.
Simply type in these command lines one-by-one in the projects directory:

```
docker compose up --build
docker compose exec -T db mariadb -uroot -p<ROOT_PASSWORD> notes_app < .\dump.sql
docker compose restart
```
You need to install openssl to generate keys for the nginx reverse-proxy server
``` ```

*aaaaaaaaaand done!*



