import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import { messaging } from './firebase-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

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

// Verificar variáveis de ambiente do Firebase
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('❌ Variáveis de ambiente do Firebase não configuradas');
  process.exit(1);
}

console.log('✅ Configuração do Firebase carregada com sucesso');

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    webhook_url: process.env.WEBHOOK_URL
  });
});

// 1. Rota principal para teste
app.get('/', (req, res) => {
  res.send('Servidor rodando. Webhook em /telegram-webhook');
});

// 2. Rota para registrar dispositivos
app.post('/register-device', async (req, res) => {
  console.log('\n=== INÍCIO DO REGISTRO DE DISPOSITIVO ===');
  console.log('Headers recebidos:', req.headers);
  console.log('Body completo:', JSON.stringify(req.body, null, 2));
  
  const { deviceToken, userId, platform } = req.body;
  
  if (!deviceToken) {
    console.log('❌ Erro: Device token não fornecido');
    return res.status(400).json({ error: 'Device token é obrigatório' });
  }

  console.log(`📱 Registrando dispositivo:
    Token: ${deviceToken}
    Usuário: ${userId || 'anônimo'}
    Plataforma: ${platform || 'ios'}`);
  
  try {
    // Armazena o token no banco de dados
    const result = await prisma.deviceToken.upsert({
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
    
    console.log('✅ Dispositivo registrado com sucesso:', result);
    res.json({ success: true, message: 'Dispositivo registrado com sucesso', data: result });
  } catch (error) {
    console.error('❌ Erro ao registrar dispositivo:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Erro ao registrar dispositivo',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    console.log('=== FIM DO REGISTRO DE DISPOSITIVO ===\n');
  }
});

// 3. Rota Webhook do Telegram
app.post('/telegram-webhook', async (req, res) => {
  // Enviar resposta imediatamente para o Telegram
  res.sendStatus(200);
  
  console.log('\n�� Telegram Webhook Acionado');
  console.log('Timestamp:', new Date().toISOString());
  console.log('URL completa:', req.protocol + '://' + req.get('host') + req.originalUrl);
  console.log('Headers:', req.headers);
  console.log('Body completo:', req.body);
  console.log('Query:', req.query);
  console.log('Method:', req.method);
  console.log('IP:', req.ip);
  
  try {
    const update = req.body;
    console.log('Update recebido do Telegram:', JSON.stringify(update, null, 2));

    if (update.message && update.message.text) {
      const messageText = update.message.text;
      const from = update.message.from;
      console.log(`📩 Mensagem: "${messageText}"`);
      console.log(`👤 De: ${from.first_name} (ID: ${from.id})`);

      console.log('🔔 Enviando notificação via Firebase...');
      // Enviar para todos os dispositivos registrados
      await sendFcmNotification(messageText, from.first_name);
      console.log('✅ Notificação enviada com sucesso');
    } else {
      console.log('⚠️ Recebido update que não é mensagem de texto:', JSON.stringify(update, null, 2));
    }

    // Log da resposta
    console.log('✅ Enviando resposta 200 para o Telegram');
  } catch (error) {
    console.error('❌ Erro no processamento do webhook:', error);
    console.error('Stack trace:', error.stack);
    console.error('Request body:', req.body);
  }
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

// 5. Função para enviar notificação via Firebase Cloud Messaging
async function sendFcmNotification(messageText, senderName) {
  try {
    // Buscar tokens no banco de dados (excluindo tokens do Expo)
    const devices = await prisma.deviceToken.findMany({
      where: {
        NOT: {
          deviceToken: {
            startsWith: 'ExpoMockPushToken'
          }
        }
      }
    });
    
    if (devices.length === 0) {
      console.log('Nenhum dispositivo registrado');
      return;
    }

    console.log(`📱 Enviando notificação para ${devices.length} dispositivo(s)`);

    for (const device of devices) {
      try {
        const message = {
          notification: {
            title: 'Futuros Tech',
            body: 'Novo sinal de entrada, caso seja Premium abra para ver!'
          },
          data: {
            sender: senderName,
            messageType: 'telegram',
            timestamp: new Date().toISOString(),
            message: messageText
          }
        };

        // Adicionar configurações específicas para iOS
        if (device.platform === 'ios') {
          message.apns = {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
                'content-available': 1
              }
            },
            fcm_options: {
              image: 'https://example.com/image.jpg'
            }
          };
        }

        // Adicionar configurações específicas para Android
        if (device.platform === 'android') {
          message.android = {
            priority: 'high',
            notification: {
              sound: 'default',
              priority: 'high',
              channelId: 'default'
            }
          };
        }

        console.log(`🚀 Enviando para token: ${device.deviceToken} (${device.platform})`);
        const response = await messaging.send({
          ...message,
          token: device.deviceToken
        });
        
        console.log(`✅ Notificação enviada com sucesso para ${device.deviceToken}. MessageID: ${response}`);
      } catch (error) {
        console.error(`❌ Erro ao enviar para ${device.deviceToken}:`, error);
        
        // Se o token for inválido, remover do banco
        if (error.code === 'messaging/invalid-registration-token' || 
            error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/third-party-auth-error') {
          console.log(`🗑️ Removendo token inválido: ${device.deviceToken}`);
          await prisma.deviceToken.delete({
            where: { deviceToken: device.deviceToken }
          });
        }
      }
    }
  } catch (error) {
    console.error('❌ Erro ao enviar notificação:', error);
    throw error;
  }
}

// 6. Iniciar servidor
const PORT = process.env.PORT || 3000;
// Rota para testar envio de notificação
app.post('/send-test-notification', async (req, res) => {
  try {
    const { userId, title, body } = req.body;
    
    // Buscar tokens do dispositivo para o usuário
    const deviceTokens = await prisma.deviceToken.findMany({
      where: {
        userId: userId
      }
    });

    if (deviceTokens.length === 0) {
      return res.status(404).json({ error: 'Nenhum dispositivo encontrado para este usuário' });
    }

    const message = {
      notification: {
        title: title || 'Futuros Tech',
        body: body || 'Notificação de teste'
      },
      data: {
        type: 'test',
        timestamp: new Date().toISOString()
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    // Enviar para cada dispositivo
    for (const device of deviceTokens) {
      try {
        console.log(`🚀 Enviando notificação de teste para: ${device.deviceToken}`);
        const response = await messaging.send({
          ...message,
          token: device.deviceToken
        });
        console.log(`✅ Notificação enviada com sucesso. MessageID: ${response}`);
      } catch (error) {
        console.error(`❌ Erro ao enviar para ${device.deviceToken}:`, error);
        
        if (error.code === 'messaging/invalid-registration-token' || 
            error.code === 'messaging/registration-token-not-registered') {
          console.log(`🗑️ Removendo token inválido: ${device.deviceToken}`);
          await prisma.deviceToken.delete({
            where: { deviceToken: device.deviceToken }
          });
        }
      }
    }

    res.json({ success: true, message: 'Notificações enviadas com sucesso' });
  } catch (error) {
    console.error('Erro ao enviar notificações:', error);
    res.status(500).json({ error: 'Erro ao enviar notificações' });
  }
});

// Rota para testar conexão com banco
app.get('/db-test', async (req, res) => {
  try {
    // Tenta contar os registros
    const count = await prisma.deviceToken.count();
    
    // Tenta buscar todos os registros
    const devices = await prisma.deviceToken.findMany();
    
    res.json({
      success: true,
      count,
      connection: 'OK',
      devices
    });
  } catch (error) {
    console.error('Erro ao testar banco:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      connection: 'FAILED'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});