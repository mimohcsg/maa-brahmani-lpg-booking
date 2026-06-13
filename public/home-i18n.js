const HOME_I18N = {
  en: {
    pageTitle: 'Maa Brahmani Gas Agency | Go Gas — Jobat',
    businessName: 'Maa Brahmani Gas Agency | Go Gas',
    tagline: 'Authorized Go Gas Distributor',
    city: 'Jobat, Madhya Pradesh',
    heroText: 'Safe LPG cylinders delivered to your doorstep in Jobat and nearby areas.',
    bookNow: 'Book LPG Online',
    callNow: 'Call Now',
    whatsapp: 'WhatsApp',
    directions: 'Get Directions',
    servicesTitle: 'Our Products',
    domesticTitle: '14.2 kg Domestic',
    domesticDesc: 'For home cooking — safe, reliable domestic LPG cylinder with home delivery.',
    commercialTitle: '19 kg Commercial',
    commercialDesc: 'For hotels, restaurants, dhabas and businesses — commercial LPG cylinder.',
    compactTitle: '5 kg Compact',
    compactDesc: 'Compact cylinder for small families, hostels and portable use.',
    whyTitle: 'Why Choose Us',
    why1: 'Authorized Go Gas distributor',
    why2: 'Fast home delivery in Jobat',
    why3: 'GST invoice on every order',
    why4: 'Easy online order request from home',
    why5: 'We confirm on WhatsApp and deliver to your door',
    contactTitle: 'Visit Us',
    addressLabel: 'Address',
    address: 'Khatali Road, in front of Shree Resorts and Farms, Jobat, Madhya Pradesh 457990',
    phoneLabel: 'Phone',
    hoursLabel: 'Hours',
    hours: 'Open daily · 8:00 AM – 8:00 PM',
    emailLabel: 'Email',
    gstLabel: 'GSTIN',
    downloadBill: 'Download Bill',
    ownerLogin: 'Owner',
    footer: 'Maa Brahmani Gas Agency | Go Gas · Jobat, Madhya Pradesh',
    developedBy: 'Developed by Yours Meshwork Private Limited',
  },
  hi: {
    pageTitle: 'माँ ब्रह्माणी गैस एजेंसी | गो गैस — जोबट',
    businessName: 'माँ ब्रह्माणी गैस एजेंसी | गो गैस',
    tagline: 'अधिकृत गो गैस वितरक',
    city: 'जोबट, मध्य प्रदेश',
    heroText: 'जोबट और आस-पास के क्षेत्र में सुरक्षित एलपीजी सिलेंडर घर पर डिलीवरी।',
    bookNow: 'ऑनलाइन एलपीजी बुक करें',
    callNow: 'अभी कॉल करें',
    whatsapp: 'व्हाट्सऐप',
    directions: 'दिशा-निर्देश',
    servicesTitle: 'हमारे उत्पाद',
    domesticTitle: '14.2 kg घरेलू',
    domesticDesc: 'घर की रसोई के लिए — सुरक्षित घरेलू एलपीजी सिलेंडर, होम डिलीवरी।',
    commercialTitle: '19 kg व्यावसायिक',
    commercialDesc: 'होटल, रेस्टोरेंट, ढाबा और व्यवसाय के लिए — कमर्शियल सिलेंडर।',
    compactTitle: '5 kg कॉम्पैक्ट',
    compactDesc: 'छोटे परिवार, हॉस्टल और पोर्टेबल उपयोग के लिए कॉम्पैक्ट सिलेंडर।',
    whyTitle: 'हमें क्यों चुनें',
    why1: 'अधिकृत गो गैस वितरक',
    why2: 'जोबट में तेज़ होम डिलीवरी',
    why3: 'हर ऑर्डर पर GST इनवॉइस',
    why4: 'घर बैठे ऑनलाइन ऑर्डर अनुरोध',
    why5: 'व्हाट्सऐप पर पुष्टि और होम डिलीवरी',
    contactTitle: 'हमसे संपर्क करें',
    addressLabel: 'पता',
    address: 'खातली रोड, श्री रिसॉर्ट्स एंड फार्म्स के सामने, जोबट, मध्य प्रदेश 457990',
    phoneLabel: 'फ़ोन',
    hoursLabel: 'समय',
    hours: 'रोज़ खुला · सुबह 8:00 – रात 8:00 बजे',
    emailLabel: 'ईमेल',
    gstLabel: 'GSTIN',
    downloadBill: 'बिल डाउनलोड',
    ownerLogin: 'मालिक',
    footer: 'माँ ब्रह्माणी गैस एजेंसी | गो गैस · जोबट, मध्य प्रदेश',
    developedBy: 'Developed by Yours Meshwork Private Limited',
  },
};

let homeLang = localStorage.getItem('lpgLang') || 'hi';

function ht(key) {
  return HOME_I18N[homeLang]?.[key] || HOME_I18N.en[key] || key;
}

function applyHomeI18n() {
  document.documentElement.lang = homeLang === 'hi' ? 'hi' : 'en';
  document.title = ht('pageTitle');
  document.querySelectorAll('[data-hi18n]').forEach((el) => {
    const key = el.getAttribute('data-hi18n');
    el.textContent = ht(key);
  });
  document.getElementById('lang-hi')?.classList.toggle('active', homeLang === 'hi');
  document.getElementById('lang-en')?.classList.toggle('active', homeLang === 'en');
}

document.getElementById('lang-hi')?.addEventListener('click', () => {
  homeLang = 'hi';
  localStorage.setItem('lpgLang', 'hi');
  applyHomeI18n();
});
document.getElementById('lang-en')?.addEventListener('click', () => {
  homeLang = 'en';
  localStorage.setItem('lpgLang', 'en');
  applyHomeI18n();
});

document.addEventListener('DOMContentLoaded', applyHomeI18n);
