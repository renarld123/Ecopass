'use strict';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const valueAt = (content, key) => key.split('.').reduce((value, part) => value?.[part], content);
const safeUrl = value => typeof value === 'string' && /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value) && !/[\u0000-\u0020\\]/.test(value);
function attribute(tag, name, value) {
  const pattern = new RegExp(`\\s${name}="[^"]*"`, 'i');
  const pair = ` ${name}="${escape(value)}"`;
  return pattern.test(tag) ? tag.replace(pattern, () => pair) : tag.replace(/>$/, () => `${pair}>`);
}

// The template's data-content bindings are leaf elements. Resolve them before the
// HTML reaches the browser so its preload scanner never requests replaced artwork.
function renderLanding(template, content, origin) {
  let html = template.replace(/<([a-z][\w-]*)\b([^>]*\bdata-content="([^"]+)"[^>]*)>[\s\S]*?<\/\1>/gi, (tag, name, attributes, key) => {
    const value = valueAt(content, key);
    return typeof value === 'string' ? `<${name}${attributes}>${escape(value)}</${name}>` : tag;
  });
  html = html.replace(/<[a-z][\w-]*\b[^>]*>/gi, tag => {
    const imageKey = tag.match(/\bdata-image="([^"]+)"/)?.[1];
    const linkKey = tag.match(/\bdata-link="([^"]+)"/)?.[1];
    if (imageKey) {
      const source = valueAt(content, imageKey);
      if (safeUrl(source)) tag = attribute(tag, 'src', source);
      tag = attribute(tag, 'decoding', 'async');
      if (/^(hero\.|brand\.)/.test(imageKey)) {
        if (imageKey === 'hero.image') tag = attribute(tag, 'fetchpriority', 'high');
      } else tag = attribute(tag, 'loading', 'lazy');
    }
    if (linkKey) {
      const href = valueAt(content, linkKey);
      if (safeUrl(href) && (!tag.startsWith('<iframe') || /^https?:\/\//i.test(href))) tag = attribute(tag, tag.startsWith('<iframe') ? 'src' : 'href', href);
    }
    if (/\bdata-contact\b/.test(tag)) tag = attribute(tag, 'href', `mailto:${content.brand.contact}`);
    if (/\bdata-favicon\b|rel="apple-touch-icon"/.test(tag) && safeUrl(content.brand.faviconImage)) tag = attribute(tag, 'href', content.brand.faviconImage);
    if (/property="og:site_name"/.test(tag)) tag = attribute(tag, 'content', content.brand.name);
    if (/property="og:url"/.test(tag)) tag = attribute(tag, 'content', `${origin}/`);
    if (/property="og:image(?::secure_url)?"|name="twitter:image"/.test(tag)) tag = attribute(tag, 'content', `${origin}/ecopass-social-card.png`);
    return tag;
  });
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escape(content.brand.name)} — Sipalay City</title>`);
  const bootstrap = JSON.stringify({ brandLogo: content.brand.logoImage, rendered: true }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  html = html.replace('</head>', () => `<script id="ecopass-bootstrap" type="application/json">${bootstrap}</script>\n</head>`);
  return html;
}

module.exports = { renderLanding };
