<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

<p align="center"><b>SerCom:</b> Ecosistema transaccional de alto impacto para la profesionalización del trabajo informal en Colombia.</p>

<p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://supabase.com/" target="_blank"><img src="https://img.shields.io/badge/Database-Supabase-3ECF8E?style=flat&logo=supabase" alt="Supabase" /></a>
<a href="https://nestjs.com/" target="_blank"><img src="https://img.shields.io/badge/built%20with-NestJS-E0234E?style=flat&logo=nestjs" alt="Built with NestJS" /></a>
</p>

# SerCom - Backend API

API robusta construida con **NestJS** y **Supabase** para gestionar la conexión entre técnicos y clientes. 

## Descripción
Este repositorio contiene la lógica de negocio, autenticación y gestión de misiones de SerCom. Actualmente, el proyecto está organizado por **módulos funcionales** para facilitar el desarrollo en paralelo.

## Estructura del Código

- `src/auth`: Gestión de seguridad y roles.
- `src/profiles`: Información detallada de usuarios.
- [cite_start]`src/services`: Creación y seguimiento de misiones [cite: 13-14].
- [cite_start]`src/supabase`: Capa de persistencia y base de datos [cite: 34-35].

## Configuración Inicial
1. Instalar dependencias:
   ```bash
    $ npm install
   ```

2. Configurar variables de entorno:
   ```bash
    $ cp .env.example .env 
   ```
   Copia .env.example a .env.
   Agrega tus llaves de Supabase (URL y KEY).

## Ejecución
   ```bash
    # Modo desarrollo (con recarga automática)
    $ npm run start:dev

    # Modo producción
    $ npm run start:prod
   ```

## Pruebas
   ```bash
    # Ejecutar pruebas unitarias
    $ npm run test

    # Ejecutar pruebas de integración
    $ npm run test:e2e

    # Test coverage (Para el reporte final)
    $ npm run test:cov
   ```

## Equipo de Ingeniería

* **Luis Cadena:** Lider de proyecto
* **Santiago Grajales:** Scrum Master
* **Isabella:** UX/UI
* **Samuel:** Desarrollador Backend
* **Melissa:** Desarrolladora Backend
* **Valentina:** QA tester