'use strict';

// Motion is progressive enhancement: content stays visible if JavaScript or
// IntersectionObserver is unavailable, and no entrance hides the first paint.
(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let observer;
  function watchSections() {
    observer?.disconnect();
    if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('reveal-in');
        observer.unobserve(entry.target);
      });
    }, { threshold: .12 });
    document.querySelectorAll('.destination-card,.feature-grid article,.stats>div,.support-contacts>a,.cta-inner').forEach((element, index) => {
      element.style.setProperty('--reveal-delay', `${(index % 3) * 65}ms`);
      if (element.getBoundingClientRect().top > window.innerHeight) observer.observe(element);
    });
  }
  watchSections();
  reducedMotion.addEventListener('change', watchSections);

  document.querySelectorAll('[data-count-action]').forEach(button => {
    button.addEventListener('click', () => {
      if (reducedMotion.matches) return;
      const output = button.closest('.counter').querySelector('output');
      output.animate([{ transform: 'translateY(3px)', opacity: .5 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 180, easing: 'ease-out' });
    });
  });

  const upload = document.querySelector('#idUploadField');
  const file = upload?.querySelector('input');
  file?.addEventListener('change', () => {
    const selected = file.files.length > 0;
    upload.classList.toggle('has-file', selected);
    upload.querySelector('use').setAttribute('href', `/landing-icons.svg#${selected ? 'check' : 'upload'}`);
  });
})();
