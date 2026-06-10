function formatPhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith('91') && digits.length === 12) return digits;
  return digits;
}

async function sendWhatsAppImage(phone, imageUrl, caption = '') {
  const formattedPhone = formatPhone(phone);
  if (!imageUrl) return { sent: false };

  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: formattedPhone,
            type: 'image',
            image: { link: imageUrl, caption: caption || 'Go Gas | Maa Brahmani Gas Agency' },
          }),
        }
      );
      if (res.ok) return { method: 'meta_image', sent: true };
    } catch (e) {
      console.error('Meta WhatsApp image failed:', e.message);
    }
  }

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) {
    try {
      const auth = Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString('base64');
      const body = new URLSearchParams({
        From: process.env.TWILIO_WHATSAPP_FROM,
        To: `whatsapp:+${formattedPhone}`,
        Body: caption || 'Go Gas | Maa Brahmani Gas Agency',
        MediaUrl: imageUrl,
      });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        }
      );
      if (res.ok) return { method: 'twilio_image', sent: true };
    } catch (e) {
      console.error('Twilio WhatsApp image failed:', e.message);
    }
  }

  return { sent: false };
}

async function sendSms(phone, message) {
  const formatted = formatPhone(phone);
  const to = formatted.startsWith('+') ? formatted : `+${formatted}`;

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM) {
    try {
      const auth = Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString('base64');
      const body = new URLSearchParams({ From: process.env.TWILIO_SMS_FROM, To: to, Body: message });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        }
      );
      if (res.ok) return { method: 'twilio_sms', sent: true };
      console.error('Twilio SMS error:', await res.text());
    } catch (e) {
      console.error('Twilio SMS failed:', e.message);
    }
  }

  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER_ID) {
    try {
      const payload = {
        sender: process.env.MSG91_SENDER_ID,
        route: '4',
        country: '91',
        sms: [{ message, to: [formatted.replace(/^91/, '')] }],
      };
      const res = await fetch('https://api.msg91.com/api/v2/sendsms', {
        method: 'POST',
        headers: { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { method: 'msg91', sent: true };
      console.error('MSG91 error:', await res.text());
    } catch (e) {
      console.error('MSG91 failed:', e.message);
    }
  }

  return { method: 'none', sent: false };
}

async function sendWhatsApp(phone, billText, pdfUrl = null, logoUrl = null) {
  const formattedPhone = formatPhone(phone);

  // Send Go Gas logo image first (when API + public URL available)
  if (logoUrl && logoUrl.startsWith('http')) {
    await sendWhatsAppImage(phone, logoUrl, '🔥 Go Gas | Maa Brahmani Gas Agency');
  }

  const message = pdfUrl
    ? `${billText}\n\n📄 Download GST Tax Invoice (PDF):\n${pdfUrl}`
    : billText;

  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && pdfUrl) {
    try {
      const docRes = await fetch(
        `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: formattedPhone,
            type: 'document',
            document: {
              link: pdfUrl,
              filename: 'GoGas-Tax-Invoice.pdf',
              caption: 'Go Gas Tax Invoice',
            },
          }),
        }
      );
      if (docRes.ok) return { method: 'meta_document', sent: true, pdfUrl, logoUrl };

      const textRes = await fetch(
        `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: formattedPhone,
            type: 'text',
            text: { body: message },
          }),
        }
      );
      if (textRes.ok) return { method: 'meta_text', sent: true, pdfUrl, logoUrl };
    } catch (e) {
      console.error('Meta WhatsApp failed:', e.message);
    }
  }

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) {
    try {
      const auth = Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString('base64');
      const params = {
        From: process.env.TWILIO_WHATSAPP_FROM,
        To: `whatsapp:+${formattedPhone}`,
        Body: message,
      };
      if (pdfUrl) params.MediaUrl = pdfUrl;

      const body = new URLSearchParams(params);
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        }
      );
      if (res.ok) return { method: pdfUrl ? 'twilio_media' : 'twilio', sent: true, pdfUrl, logoUrl };
      console.error('Twilio WhatsApp error:', await res.text());
    } catch (e) {
      console.error('Twilio WhatsApp failed:', e.message);
    }
  }

  const waLink = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
  return { method: 'wa_link', sent: false, waLink, pdfUrl, logoUrl };
}

async function notifyCustomer(order, billText, extras = {}) {
  const pdfUrl = extras.pdfUrl || null;
  const logoUrl = extras.logoUrl || null;
  const results = { whatsapp: null, sms: null, pdfUrl, logoUrl };

  results.whatsapp = await sendWhatsApp(order.phone, billText, pdfUrl, logoUrl);

  const smsText = extras.smsText || billText.slice(0, 200);
  const smsWithPdf = pdfUrl ? `${smsText} PDF: ${pdfUrl}` : smsText;
  results.sms = await sendSms(order.phone, smsWithPdf.slice(0, 480));

  return results;
}

async function notifyBusiness(message) {
  const businessPhone = process.env.BUSINESS_PHONE;
  if (!businessPhone) return { sent: false };
  return sendSms(businessPhone, message);
}

module.exports = { formatPhone, sendSms, sendWhatsApp, sendWhatsAppImage, notifyCustomer, notifyBusiness };
