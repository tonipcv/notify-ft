FROM node:18-alpine

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./
COPY prisma ./prisma/
COPY AuthKey_2B7PM6X757.p8 ./

# Instalar dependências
RUN npm install

# Copiar o resto dos arquivos
COPY . .

# Gerar Prisma Client
RUN npx prisma generate

# Expor a porta
EXPOSE 3000

# Comando para iniciar
CMD ["npm", "start"] 