# Smart notes application!

## 1. INTRO

This is a docker compose enviroment, for the app creating smart notes locally.

## 2. ENVIROMENT

Before you do anything you NEED to edit these lines of the ```docker-compose.yml``` file:
```
- DB_PASSWORD=<DATABASE_USER_PASSWORD>

- MARIADB_ROOT_PASSWORD=<ROOT_PASSWORD>

- MARIADB_PASSWORD=<DATABASE_USER_PASSWORD>
```
Make sure you fill them with your own credentials.

## 3. CERTIFICATES

You also need to install openssl and generate CA certificates for your own hosted nginx reverse-proxy server:
``` 
sudo apt install -y openssl && mkdir certs && cd certs && openssl req -x509 -newkey rsa:2048 -sha256 -days 365 \
  -nodes \
  -keyout localhost.key \
  -out localhost.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

## 4. COMPOSING DOCKER CONTAINERS

At this point to run the project you only need to have docker installed.

Simply type in these command lines one-by-one in the projects directory:

```
docker compose up -d --build
docker compose exec -T db mariadb -uroot -p<ROOT_PASSWORD> notes_app < .\dump.sql
docker compose restart
```

*aaaaaaaaaand done!*

## 5. ENJOY

You are now hosting an nginx reverse-proxy server, listening on the 8443 port, that will redirect all you traffic to the note application through https!

To use the app, simply visit ```https://localhost:8443``` on a web browser.


