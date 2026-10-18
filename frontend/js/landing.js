// WorkCred Landing Page Progressive Enhancements
// Strictly optional; page is fully accessible with JavaScript disabled.

document.addEventListener('DOMContentLoaded', () => {
  // Respect prefers-reduced-motion
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return;

  // Add scroll reveal if IntersectionObserver is supported
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, {
      rootMargin: '0px 0px -50px 0px',
      threshold: 0.1
    });

    document.querySelectorAll('.landing-section').forEach(sec => {
      sec.classList.add('reveal-on-scroll');
      observer.observe(sec);
    });
  }
});
