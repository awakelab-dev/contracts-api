# Contracts App - Backend API

## Configuración Local
1. **Instalar dependencias**: `npm install`
2. **Ejecutar API**: `npm run dev`
3. **Base de Datos**: 
   - Crear DB `contracts_app` en MySQL.
   - Ejecutar el script `schema.sql` incluido en el repo.
4. **Variables de Entorno (.env)**:
   - `DB_HOST=localhost`
   - `DB_USER=root`
   - `DB_PASSWORD=tu_password`
   - `DB_NAME=contracts_app`
   - `JWT_SECRET=tu_secreto_super_seguro`

## Prefijos de rutas soportados
- La API acepta rutas tanto en raíz como con prefijo `/api`.
- Ejemplos equivalentes:
  - `/auth/login` y `/api/auth/login`
  - `/students` y `/api/students`

## Módulos Implementados
- **Auth**: Autenticación JWT básica.
- **Students**: CRUD completo y visualización de expedientes.
- **Companies**: Gestión de empresas colaboradoras.
- **Vacancies**: Control de vacantes por empresa.
- **Interviews**: Seguimiento de entrevistas de alumnos.
- **Internships**: Gestión de prácticas no laborales.