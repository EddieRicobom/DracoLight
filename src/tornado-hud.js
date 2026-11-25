import './tornado-hud.css';

export function createTornadoHud(hud, detector) {
  const container = document.createElement('div');
  container.className = 'tornado-hud';
  container.hidden = true;
  const ring = document.createElement('span');
  ring.className = 'tornado-hud-ring';
  ring.setAttribute('role', 'progressbar');
  ring.setAttribute('aria-label', 'Formação do tornado de tinta');
  ring.setAttribute('aria-valuemin', '0');
  ring.setAttribute('aria-valuemax', '100');
  const label = document.createElement('span');
  label.setAttribute('role', 'status');
  container.append(ring, label);
  hud.append(container);

  let completedGeneration = 0;
  let confirmationTime = 0;
  let shownProgress = -1;
  let shownDirection = 0;
  let shownStage = '';

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

    const stage = formed ? 'formed' : 'forming';
    if (stage !== shownStage) {
      container.dataset.stage = stage;
      label.textContent = formed ? 'Tornado criado!' : 'Feche a volta';
      shownStage = stage;
    }
    if (progress !== shownProgress) {
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
