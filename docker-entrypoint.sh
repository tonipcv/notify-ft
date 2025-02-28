#!/bin/sh

# Executar migrações do Prisma
echo "Running database migrations..."
npx prisma migrate deploy

# Iniciar a aplicação
echo "Starting application..."
npm start 