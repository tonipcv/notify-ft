import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function testConnection() {
  try {
    console.log('Testando conexão com o banco de dados...');
    console.log('URL do banco:', process.env.DATABASE_URL);
    
    // Tenta criar um registro de teste
    const testDevice = await prisma.deviceToken.create({
      data: {
        deviceToken: 'test-token-' + Date.now(),
        userId: 'test-user',
        platform: 'test'
      }
    });
    
    console.log('✅ Registro de teste criado com sucesso:', testDevice);
    
    // Lista todos os registros
    const allDevices = await prisma.deviceToken.findMany();
    console.log('📱 Todos os dispositivos:', allDevices);
    
    // Remove o registro de teste
    await prisma.deviceToken.delete({
      where: { id: testDevice.id }
    });
    
    console.log('✅ Teste concluído com sucesso!');
  } catch (error) {
    console.error('❌ Erro no teste:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
