import './tornado-hud.css';

export function createTornadoHud(hud, detector) {
  const container = document.createElement('div');
  container.className = 'tornado-hud';
  container.hidden = true;
  const ring = document.createElement('span');
  ring.className = 'tornado-hud-ring';
  ring.setAttribute('role', 'progressbar');
  ring.setAttribute('aria-label', 'Formação do tornado de tinta');
  const label = document.createElement('span');
  label.setAttribute('role', 'status');
  container.append(ring, label);
  hud.append(container);

  let completedGeneration = 0;
  let confirmationTime = 0;
  let shownProgress = -1;
  let shownDirection = 0;

  return (dt, enabled) => {
    if (!enabled) {
      confirmationTime = 0;
      if (!container.hidden) container.hidden = true;
      return;
    }
    if (detector.emittedAt && detector.generation !== completedGeneration) {
      completedGeneration = detector.generation;
      confirmationTime = 1.4;
    } else {
      confirmationTime = Math.max(0, confirmationTime - dt);
    }

    const formed = confirmationTime > 0;
    const progress = formed ? 100 : Math.floor(detector.formationProgress * 25) * 4;
    const hidden = progress < 12;
    if (container.hidden !== hidden) container.hidden = hidden;
    if (hidden) return;

    if (progress !== shownProgress) {
      if ((shownProgress === 100) !== formed || shownProgress < 0) {
        container.dataset.stage = formed ? 'formed' : 'forming';
        label.textContent = formed ? 'Tornado criado!' : 'Feche a volta';
      }
      ring.style.setProperty('--tornado-fill', `${progress}%`);
      ring.setAttribute('aria-valuenow', String(progress));
      shownProgress = progress;
    }
    if (detector.sign && detector.sign !== shownDirection) {
      ring.style.setProperty('--tornado-direction', detector.sign);
      shownDirection = detector.sign;
    }
  };
}
