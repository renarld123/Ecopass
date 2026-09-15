'use strict';

module.exports = Object.freeze({
  brand: {
    name: 'EcoPass',
    tagline: 'Travel lighter. Leave better.',
    contact: 'info@ecopass.ph',
    logoImage: '/ecopass-logo-v2.png',
    faviconImage: '/ecopass-logo-v2.png'
  },
  hero: {
    eyebrow: 'SMART · SIMPLE · SUSTAINABLE',
    title: 'Explore responsibly. Travel effortlessly.',
    titleLine1: 'Explore responsibly.',
    titleLine2: 'Travel effortlessly.',
    description: 'Your digital pass to unforgettable destinations—faster entry, less paper, and a lighter footprint.',
    primaryButton: 'Get Your EcoPass',
    secondaryButton: 'See How It Works',
    benefits: [
      { label: 'QR-powered', iconImage: '/ecopass-benefit-qr.svg' },
      { label: 'Paperless', iconImage: '/ecopass-benefit-paperless.svg' },
      { label: 'Tourist-friendly', iconImage: '/ecopass-benefit-tourist.svg' }
    ],
    backgroundImage: '/ecopass-cream-texture.png',
    image: '/ecopass-hero-upload-transparent.png'
  },
  how: {
    title: 'How EcoPass works',
    description: 'From discovery to entry in three simple steps.',
    backgroundImage: '/ecopass-cream-texture.png',
    phoneImage: '/ecopass-phone-cutout.png',
    leavesImage: '/ecopass-how-leaves-reference.png',
    steps: [
      { number: '01', title: 'Choose a destination', description: 'Browse places, learn about entry requirements, and plan your visit.', iconImage: '/ecopass-step-destination.svg' },
      { number: '02', title: 'Get your digital pass', description: 'Purchase your pass in minutes and receive it instantly on your phone.', iconImage: '/ecopass-step-phone.svg' },
      { number: '03', title: 'Scan and explore', description: 'Present your QR code for quick entry and enjoy your journey responsibly.', iconImage: '/ecopass-step-scan.svg' }
    ]
  },
  destinations: {
    title: 'Discover places worth protecting',
    exploreButton: 'Explore →',
    items: [
      { tag: 'BEACHES', title: 'Island Escapes', location: 'El Nido, Palawan', description: 'Pristine islands and turquoise waters await.', image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=85' },
      { tag: 'ADVENTURE', title: 'Nature & Adventure', location: 'Kawasan Falls, Cebu', description: 'Chase waterfalls and breathtaking trails.', image: 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=1000&q=85' },
      { tag: 'CULTURE', title: 'Community Experiences', location: 'Siargao, Surigao del Norte', description: 'Experience local life and protect traditions.', image: 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1000&q=85' }
    ]
  },
  impact: {
    title: 'Small choices. Lasting impact.',
    description: 'Every digital pass helps make tourism lighter on the places we love.',
    backgroundImage: '/ecopass-green-contour-background.png',
    emblemImage: '/ecopass-impact-emblem.png',
    leavesImage: '/ecopass-how-leaves-reference.png',
    stats: [
      { value: '100%', label: 'Paperless', description: 'No paper. No waste. All digital.' },
      { value: 'Faster', label: 'Entry', description: 'Less waiting, more adventures.' },
      { value: 'More Local', label: 'Support', description: 'Your visit supports local communities.' }
    ]
  },
  journey: {
    title: 'Designed for better journeys',
    description: 'One simple pass keeps your visit organized while supporting responsible tourism.',
    image: '/ecopass-journey-walkway-v2.png',
    button: 'Learn More',
    features: [
      { title: 'Easy mobile access', description: 'Your pass is always with you on your phone.' },
      { title: 'Secure QR validation', description: 'Fast, reliable, and encrypted for your peace of mind.' },
      { title: 'Curated local destinations', description: 'Handpicked spots that protect nature and culture.' },
      { title: 'Eco-conscious experiences', description: 'Travel in ways that leave no trace behind.' }
    ]
  },
  stories: {
    title: 'Travel stories that inspire',
    items: [
      { rating: '★★★★★', quote: '“EcoPass made our trip so smooth. No long lines, just stunning views and amazing locals.”', initials: 'MR', name: 'Maya R.', location: 'Manila, Philippines', avatarImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=160&q=85' },
      { rating: '★★★★★', quote: '“I love that my visit helps support local communities. EcoPass is travel with purpose.”', initials: 'JL', name: 'James L.', location: 'Sydney, Australia', avatarImage: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&q=85' },
      { rating: '★★★★★', quote: '“From buying to entry, everything was effortless. Highly recommended for responsible travelers!”', initials: 'PK', name: 'Priya K.', location: 'Singapore', avatarImage: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=160&q=85' }
    ]
  },
  support: {
    title: 'Support',
    description: 'For inquiries or assistance with EcoPass, reach us through the contact options below.',
    email: 'info@ecopass.ph',
    emailUrl: 'mailto:info@ecopass.ph',
    phone: 'Phone support coming soon',
    phoneUrl: '#support',
    facebookLabel: 'Facebook Page',
    facebookUrl: 'https://www.facebook.com/',
    messengerLabel: 'Message Us',
    messengerUrl: 'https://www.messenger.com/',
    address: 'Sipalay City, Negros Occidental, Philippines',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Sipalay+City%2C+Negros+Occidental%2C+Philippines',
    mapEmbedUrl: 'https://www.google.com/maps?q=Sipalay+City%2C+Negros+Occidental%2C+Philippines&output=embed'
  },
  registration: {
    title: 'Tourist Registration',
    description: 'A quick, secure registration for your Sipalay adventure',
    fullNameLabel: 'Full Name',
    addressLabel: 'Address',
    contactLabel: 'Contact Number',
    visitDateLabel: 'Date of Visit',
    stayLabel: 'Length of Stay',
    groupTitle: 'Group Composition',
    adultLabel: 'Adult (Local)',
    foreignLabel: 'Foreign Visitor',
    seniorLabel: 'Senior / PWD / Student',
    childLabel: 'Children below 8',
    idLabel: 'Upload a valid ID for each discounted visitor',
    idNote: 'A valid ID is required for every senior, PWD, or student claiming the discounted rate.',
    continueButton: 'Continue to Payment',
    paymentTitle: 'Payment',
    paymentDescription: 'Environmental User Fee (EUF)',
    paymentMethodTitle: 'Select Payment Method',
    paymentNotice: 'Your selected payment method will be recorded. No charge is made on this demonstration site.',
    backButton: 'Back',
    completeButton: 'Complete Registration',
    successTitle: 'Registration Successful!',
    successDescription: 'Your verified EcoPass is ready. Keep it handy for a smooth arrival and complete payment through your selected method.',
    downloadButton: 'Download Pass',
    saveButton: 'Save Pass',
    paymentMethods: ['GCash', 'Maya', 'Credit/Debit Card', 'Pay at Tourism Office (Cash)', 'Physical Payment']
  },
  cta: {
    title: 'Ready for your next meaningful journey?',
    description: 'Get your EcoPass and explore with less waiting, less paper, and more purpose.',
    button: 'Get Your EcoPass',
    secondaryButton: 'Browse Destinations',
    backgroundImage: '/ecopass-green-contour-background.png',
    phoneImage: '/ecopass-phone-cutout.png',
    leavesImage: '/ecopass-how-leaves-reference.png'
  },
  footer: {
    exploreTitle: 'Explore',
    destinationsLink: 'Destinations',
    howLink: 'How It Works',
    aboutLink: 'About',
    ecoPassTitle: 'EcoPass',
    getPassLink: 'Get Your Pass',
    benefitsLink: 'Benefits',
    blogLink: 'Blog',
    supportPageLink: 'Support',
    supportTitle: 'Support',
    faqsLink: 'FAQs',
    contactLink: 'Contact Us',
    helpLink: 'Help Center',
    followTitle: 'Follow',
    copyright: '© 2026 EcoPass. Travel lighter.'
  },
  updatedAt: null
});
