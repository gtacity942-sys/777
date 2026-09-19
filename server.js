// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// CORS para que tu index.html pueda llamar al servidor
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // En producción cambia '*' por tu dominio
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const {
  WOMPI_PUBLIC_KEY,
  WOMPI_PRIVATE_KEY,
  WOMPI_EVENTS_KEY,
  WOMPI_INTEGRITY_KEY
} = process.env;

// Sandbox → cambia a https://production.wompi.co/v1 en producción
const WOMPI_API = 'https://production.wompi.co/v1';

// ─── Ruta de prueba ───
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor Kalley + Wompi funcionando' });
});

// ─── Obtener Acceptance Token ───
async function getAcceptanceToken() {
  const res = await axios.get(`${WOMPI_API}/merchants/${WOMPI_PUBLIC_KEY}`);
  return res.data.data.presigned_acceptance.acceptance_token;
}

// ─── Crear transacción ───
app.post('/crear-pago-wompi', async (req, res) => {
  try {
    const { orderId, amountInCents, customerEmail, paymentMethodType, paymentMethodDetails } = req.body;

    if (!orderId || !amountInCents || !customerEmail || !paymentMethodType) {
      return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
    }

    // Firma de integridad: reference + amount_in_cents + currency + integrity_key
    const signature = crypto
      .createHash('sha256')
      .update(`${orderId}${amountInCents}COP${WOMPI_INTEGRITY_KEY}`)
      .digest('hex');

    const acceptanceToken = await getAcceptanceToken();

    const payload = {
      amount_in_cents: amountInCents,
      currency: 'COP',
      customer_email: customerEmail,
      reference: orderId,
      signature: signature,
      acceptance_token: acceptanceToken,
      payment_method_type: paymentMethodType,
      payment_method: paymentMethodDetails,
      redirect_url: 'https://tu-dominio.com/pago-resultado'
    };

    const response = await axios.post(`${WOMPI_API}/transactions`, payload, {
      headers: {
        Authorization: `Bearer ${WOMPI_PRIVATE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    res.json({
      success: true,
      transactionId: response.data.data.id,
      status: response.data.data.status,
      checkoutUrl: `https://checkout.wompi.co/p/?public-key=${WOMPI_PUBLIC_KEY}&currency=COP&amount-in-cents=${amountInCents}&reference=${orderId}&signature:integrity=${signature}`
    });

  } catch (error) {
    console.error('Error creando transacción:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'No se pudo iniciar el pago.',
      detail: error.response?.data || error.message
    });
  }
});

// ─── Webhook de Wompi ───
app.post('/webhook-wompi', (req, res) => {
  const event = req.body;
  const receivedChecksum = req.headers['x-event-checksum'];

  if (!receivedChecksum) {
    console.warn('Webhook sin checksum');
    return res.status(400).send('Falta checksum');
  }

  const dataString = JSON.stringify(event.data);
  const timestamp = event.sent_at;
  const computedChecksum = crypto
    .createHash('sha256')
    .update(`${dataString}${timestamp}${WOMPI_EVENTS_KEY}`)
    .digest('hex');

  if (computedChecksum !== receivedChecksum) {
    console.warn('Checksum inválido');
    return res.status(400).send('Firma inválida');
  }

  console.log('✅ Webhook Wompi válido:', event.event);

  if (event.event === 'transaction.updated') {
    const tx = event.data.transaction;
    console.log(`Transacción ${tx.id} → ${tx.status}`);
    // Aquí actualizas tu base de datos según tx.status:
    // APPROVED, DECLINED, VOIDED, ERROR
  }

  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));