import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import apn from 'apn'; // Adicione esta dependência para APNs
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

// Middleware de logging
app.use((req, res, next) => {
  console.log('\n=== Nova Requisição ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Método:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('=====================\n');
  next();
});

const DEBUG = true;

// Configuração do provedor APNs
const apnProvider = new apn.Provider({
  token: {
    key: process.env.NODE_ENV === 'production' 
      ? process.env.APNS_KEY_PATH 
      : path.join(__dirname, 'AuthKey_2B7PM6X757.p8'),
    keyId: process.env.APNS_KEY_ID,
    teamId: process.env.APNS_TEAM_ID,
  },
  production: process.env.NODE_ENV === 'production'
});

// 1. Rota principal para teste
app.get('/', (req, res) => {
  res.send('Servidor rodando. Webhook em /telegram-webhook');
});

// 2. Rota para registrar dispositivos
app.post('/register-device', async (req, res) => {
  const { deviceToken, userId, platform } = req.body;
  
  if (!deviceToken) {
    return res.status(400).json({ error: 'Device token é obrigatório' });
  }

  console.log(`📱 Registrando dispositivo: ${deviceToken} para usuário: ${userId || 'anônimo'}`);
  
  try {
    // Armazena o token no banco de dados
    await prisma.deviceToken.upsert({
      where: { deviceToken },
      update: {
        userId: userId || 'anônimo',
        platform: platform || 'ios',
      },
      create: {
        deviceToken,
        userId: userId || 'anônimo',
        platform: platform || 'ios',
      }
    });
    
    res.json({ success: true, message: 'Dispositivo registrado com sucesso' });
  } catch (error) {
    console.error('Erro ao registrar dispositivo:', error);
    res.status(500).json({ error: 'Erro ao registrar dispositivo' });
  }
});

// 3. Rota Webhook do Telegram
app.post('/telegram-webhook', async (req, res) => {
  console.log('\n🤖 Telegram Webhook Acionado');
  console.log('Timestamp:', new Date().toISOString());
  console.log('URL completa:', req.protocol + '://' + req.get('host') + req.originalUrl);
  console.log('Headers:', req.headers);
  console.log('Body completo:', req.body);
  console.log('Query:', req.query);
  
  try {
    const update = req.body;
    console.log('Update recebido do Telegram:', JSON.stringify(update, null, 2));

    if (update.message && update.message.text) {
      const messageText = update.message.text;
      const from = update.message.from;
      console.log(`📩 Mensagem: "${messageText}"`);
      console.log(`👤 De: ${from.first_name} (ID: ${from.id})`);

      console.log('🔔 Enviando notificação via APNs...');
      // Enviar para todos os dispositivos registrados
      await sendApnsNotification(messageText, from.first_name);
      console.log('✅ Notificação enviada com sucesso');
    } else {
      console.log('⚠️ Recebido update que não é mensagem de texto:', JSON.stringify(update, null, 2));
    }

    console.log('✅ Webhook processado com sucesso');
    return res.sendStatus(200);
  } catch (error) {
    console.error('❌ Erro no processamento do webhook:', error);
    console.error('Stack trace:', error.stack);
    return res.sendStatus(500);
  }
});

// Rota de teste para o webhook
app.post('/test-webhook', (req, res) => {
  console.log('Teste de webhook recebido:');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  res.send('Teste de webhook recebido com sucesso');
});

// 4. Rota para configurar webhook do Telegram
app.get('/setup-webhook', async (req, res) => {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  
  console.log('Configurando webhook com:');
  console.log('Token:', TELEGRAM_BOT_TOKEN);
  console.log('URL:', WEBHOOK_URL);
  
  try {
    // Verificar status atual
    const statusResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
    );
    const statusData = await statusResponse.json();
    console.log('Status atual detalhado do webhook:', JSON.stringify(statusData, null, 2));

    // Configurar novo webhook
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: WEBHOOK_URL,
          allowed_updates: ["message", "edited_message", "callback_query"]
        })
      }
    );
    const data = await response.json();
    console.log('Resposta da configuração do webhook:', JSON.stringify(data, null, 2));
    
    res.json({
      status: 'Verificação completa',
      webhookInfo: statusData,
      setupResponse: data
    });
  } catch (error) {
    console.error('Erro ao configurar webhook:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Erro ao configurar webhook',
      details: error.message,
      stack: error.stack
    });
  }
});

// 5. Função para enviar notificação via APNs
async function sendApnsNotification(messageText, senderName) {
  try {
    // Buscar tokens no banco de dados
    const devices = await prisma.deviceToken.findMany({
      where: {
        platform: 'ios'
      }
    });
    
    if (devices.length === 0) {
      console.log('Nenhum dispositivo iOS registrado');
      return;
    }

    const notification = new apn.Notification();
    
    // Configurar a notificação
    notification.expiry = Math.floor(Date.now() / 1000) + 3600;
    notification.badge = 1;
    notification.sound = 'default';
    notification.alert = {
      title: `Futuros Tech`,
      body: `Novo sinal de entrada, caso seja Premium abra para ver!`
    };
    notification.topic = process.env.BUNDLE_ID;
    
    notification.payload = {
      sender: senderName,
      messageType: 'telegram',
      timestamp: new Date().toISOString()
    };

    // Extrair apenas os tokens
    const iosTokens = devices.map(device => device.deviceToken);
    
    console.log(`Enviando notificação para ${iosTokens.length} dispositivos iOS`);
    const result = await apnProvider.send(notification, iosTokens);
    
    console.log('Resultado do envio:', JSON.stringify(result, null, 2));
    
    // Verificar falhas
    if (result.failed.length > 0) {
      console.error('Falhas no envio:', result.failed);
      
      // Remover tokens inválidos do banco
      for (const item of result.failed) {
        if (item.response && (
          item.response.reason === 'BadDeviceToken' || 
          item.response.reason === 'Unregistered'
        )) {
          console.log(`Removendo token inválido: ${item.device}`);
          await prisma.deviceToken.delete({
            where: { deviceToken: item.device }
          });
        }
      }
    }
  } catch (error) {
    console.error('Erro ao enviar notificação via APNs:', error);
  }
}

// 6. Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || 'desenvolvimento'}`);
});

// 7. Limpar recursos ao encerrar
process.on('SIGINT', async () => {
  console.log('Encerrando servidor e conexões...');
  await prisma.$disconnect();
  apnProvider.shutdown();
  process.exit();
});

// Rota para listar dispositivos registrados
app.get('/devices', async (req, res) => {
  try {
    const devices = await prisma.deviceToken.findMany();
    res.json({
      count: devices.length,
      devices: devices
    });
  } catch (error) {
    console.error('Erro ao listar dispositivos:', error);
    res.status(500).json({ error: 'Erro ao listar dispositivos' });
  }
});