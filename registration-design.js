'use strict';

document.querySelector('#how-start')?.addEventListener('click', () => {
  document.querySelector('#how-modal').close();
  openPassModal();
});

(() => {
  const modal = document.querySelector('#pass-modal');
  const form = document.querySelector('#passForm');
  if (!modal || !form) return;
  const amount = modal.querySelector('[data-trip-total]');
  const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
  let previousAmount = '';
  function updateTripSummary() {
    const step = [...modal.querySelectorAll('[data-pass-step]')].find(section => !section.hidden)?.dataset.passStep || '1';
    modal.dataset.currentStep = step;
    const pass = step === '3' ? currentPass : null;
    const groups = pass?.groups || registrationCounts;
    const guests = Object.values(groups).reduce((sum, count) => sum + count, 0);
    modal.querySelector('[data-trip-guests]').textContent = `${guests} ${guests === 1 ? 'guest' : 'guests'}`;
    modal.querySelector('[data-trip-stay]').textContent = pass?.stay || form.elements.stay.value;
    const date = pass?.visitDate || form.elements.visitDate.value;
    const parsedDate = date ? new Date(`${date}T00:00:00`) : null;
    modal.querySelector('[data-trip-date]').textContent = parsedDate && !Number.isNaN(parsedDate.getTime()) ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsedDate) : 'Choose your visit date';
    const formattedAmount = money.format(pass?.amount ?? registrationTotal());
    if (formattedAmount !== previousAmount) {
      amount.textContent = formattedAmount;
      if (previousAmount && modal.open && !matchMedia('(prefers-reduced-motion: reduce)').matches) amount.animate([{ opacity:.4, transform:'translateY(4px)' }, { opacity:1, transform:'translateY(0)' }], { duration:220, easing:'ease-out' });
      previousAmount = formattedAmount;
    }
    modal.querySelector('[data-trip-fee-note]').textContent = pass?.paymentStatus === 'PAID' ? 'Payment confirmed' : 'Estimated total for your group';
    modal.querySelectorAll('[data-group]').forEach(row => row.classList.toggle('has-guests', groups[row.dataset.group] > 0));
  }
  form.addEventListener('input', updateTripSummary);
  form.addEventListener('change', updateTripSummary);
  form.addEventListener('click', event => { if (event.target.closest('[data-count-action]')) queueMicrotask(updateTripSummary); });
  new MutationObserver(updateTripSummary).observe(form, { attributes:true, subtree:true, attributeFilter:['hidden'] });
  new MutationObserver(() => { if (modal.open) updateTripSummary(); }).observe(modal, { attributes:true, attributeFilter:['open'] });
  updateTripSummary();
})();
