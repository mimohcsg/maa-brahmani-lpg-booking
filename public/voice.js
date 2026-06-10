/**
 * Web Speech API — voice input for customer form fields.
 * Supports Hindi (hi-IN) and English (en-IN).
 */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let activeFieldId = null;
let activeMicBtn = null;

function isVoiceSupported() {
  return Boolean(SpeechRecognition);
}

function getSpeechLang() {
  return typeof currentLang !== 'undefined' && currentLang === 'hi' ? 'hi-IN' : 'en-IN';
}

function extractPhoneDigits(text) {
  const wordMap = {
    zero: '0', one: '1', two: '2', three: '3', four: '4',
    five: '5', six: '6', seven: '7', eight: '8', nine: '9',
    शून्य: '0', एक: '1', दो: '2', तीन: '3', चार: '4',
    पांच: '5', पाँच: '5', छह: '6', सात: '7', आठ: '8', नौ: '9',
  };
  let normalized = text.toLowerCase();
  Object.entries(wordMap).forEach(([word, digit]) => {
    normalized = normalized.replace(new RegExp(word, 'gi'), digit);
  });
  return normalized.replace(/\D/g, '').slice(0, 10);
}

function processTranscript(fieldId, transcript) {
  const field = document.getElementById(fieldId);
  if (!field) return;

  const text = transcript.trim();
  if (!text) return;

  if (fieldId === 'phone') {
    const digits = extractPhoneDigits(text);
    if (digits) {
      field.value = digits;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }

  if (field.tagName === 'TEXTAREA' && field.value.trim()) {
    field.value = `${field.value.trim()} ${text}`;
  } else {
    field.value = text;
  }

  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function setVoiceStatus(message, isError = false) {
  const el = document.getElementById('voice-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
  el.classList.toggle('voice-status-error', isError);
}

function stopVoice() {
  if (recognition) {
    try { recognition.stop(); } catch (_) { /* ignore */ }
  }
  if (activeMicBtn) {
    activeMicBtn.classList.remove('listening');
    activeMicBtn.setAttribute('aria-pressed', 'false');
  }
  activeFieldId = null;
  activeMicBtn = null;
}

function startVoice(fieldId, micBtn) {
  if (!isVoiceSupported()) {
    setVoiceStatus(t('voiceNotSupported'), true);
    return;
  }

  if (activeFieldId === fieldId && activeMicBtn === micBtn) {
    stopVoice();
    setVoiceStatus('');
    return;
  }

  stopVoice();
  activeFieldId = fieldId;
  activeMicBtn = micBtn;

  recognition = new SpeechRecognition();
  recognition.lang = getSpeechLang();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  micBtn.classList.add('listening');
  micBtn.setAttribute('aria-pressed', 'true');
  setVoiceStatus(t('voiceListening'));

  recognition.onresult = (event) => {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    if (finalText) {
      processTranscript(fieldId, finalText);
      setVoiceStatus(t('voiceDone'));
    } else if (interimText) {
      setVoiceStatus(`${t('voiceListening')}: ${interimText}`);
    }
  };

  recognition.onerror = (event) => {
    const errors = {
      'no-speech': 'voiceNoSpeech',
      'not-allowed': 'voiceDenied',
      'network': 'voiceNetwork',
    };
    const key = errors[event.error] || 'voiceError';
    setVoiceStatus(t(key), true);
    stopVoice();
  };

  recognition.onend = () => {
    if (activeMicBtn) {
      activeMicBtn.classList.remove('listening');
      activeMicBtn.setAttribute('aria-pressed', 'false');
    }
    activeFieldId = null;
    activeMicBtn = null;
    setTimeout(() => {
      const status = document.getElementById('voice-status');
      if (status && !status.classList.contains('voice-status-error')) {
        status.classList.add('hidden');
      }
    }, 2500);
  };

  try {
    recognition.start();
  } catch (e) {
    setVoiceStatus(t('voiceError'), true);
    stopVoice();
  }
}

function initVoiceButtons() {
  document.querySelectorAll('.voice-btn:not([data-voice-init])').forEach((btn) => {
    btn.setAttribute('data-voice-init', '1');
    const fieldId = btn.getAttribute('data-field');
    btn.setAttribute('aria-label', t('voiceTap'));
    btn.title = t('voiceTap');

    if (!isVoiceSupported()) {
      btn.disabled = true;
      btn.title = t('voiceNotSupported');
      return;
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      startVoice(fieldId, btn);
    });
  });

  if (!isVoiceSupported()) {
    const hint = document.querySelector('.voice-hint');
    if (hint) hint.textContent = t('voiceNotSupported');
  }
}

function onVoiceLangChange() {
  if (recognition && activeFieldId) {
    recognition.lang = getSpeechLang();
  }
  document.querySelectorAll('.voice-btn').forEach((btn) => {
    if (!btn.disabled) {
      btn.setAttribute('aria-label', t('voiceTap'));
      btn.title = t('voiceTap');
    }
  });
}
