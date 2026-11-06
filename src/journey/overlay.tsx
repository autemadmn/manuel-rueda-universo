import type { JourneyControls } from './runtime';
import './style.css';

const SOURCE = 'https://www.espaciomisterio.com/misterios/manuel-rueda-el-pintor-de-ovnis_20341';

export function JourneyOverlay({journey, visible, reduced}:{journey:JourneyControls;visible:boolean;reduced:boolean}) {
  const {runtime,phase} = journey;
  const travelling = phase === 'playing' || phase === 'paused';
  const waiting = phase === 'loading';
  return <div ref={el => { runtime.overlay = el; }} className={`journey-shell ${visible && phase !== 'free' ? 'is-visible' : ''}`} aria-hidden={!visible || phase === 'free'} data-journey-phase={phase}>
    <button className="journey-portrait-hit" aria-label="Entrar pulsando el retrato" onClick={journey.start} disabled={!runtime.ready || phase!=='portrait'}/>
    <div className="journey-welcome" data-welcome>
      <p className="journey-kicker">UTIEL · PINTURA Y MEMORIA</p>
      <h1>Manuel<br/><em>Rueda.</em></h1>
      <p className="journey-intro-line">Su retrato, hecho con sus obras.</p>
      <button className="journey-enter" onClick={journey.start} disabled={!runtime.ready || phase !== 'portrait'}>Entrar en su mundo <span aria-hidden="true">↗</span></button>
      <p className="journey-load" role="status">{waiting ? 'Preparando el retrato y las pinturas…' : phase === 'error' ? 'No se ha podido preparar el retrato.' : 'También puedes pulsar el retrato.'}</p>
      {phase === 'error' && <button className="text-link" onClick={() => location.reload()}>Reintentar ↗</button>}
    </div>
    <div className="journey-words" aria-live="off">
      <div data-beat="1" className="journey-beat"><blockquote>Primero mi padre,<br/>luego pintor.</blockquote><p>Pepa Rueda, su hija.</p></div>
      <div data-beat="2" className="journey-beat"><blockquote>Su máximo anhelo<br/>era crear.</blockquote><p>Pepa Rueda.</p></div>
      <div data-beat="3" className="journey-beat"><p className="journey-editorial">Hoy, su obra<br/>nos invita a conocerlo.</p></div>
    </div>
    <p className="journey-loading-credit">Retrato de Manuel · Antonio Sánchez Campillos · Archivo familiar</p>
    <div className="journey-navigation">
      {travelling && <button className="journey-pause" onClick={phase === 'paused' ? journey.resume : journey.pause} aria-label={phase === 'paused' ? 'Continuar introducción' : 'Pausar introducción'}>{phase === 'paused' ? '▷ Continuar' : 'Ⅱ Pausar'}</button>}
      <button className="journey-skip" onClick={journey.skip}>Saltar introducción <span aria-hidden="true">→</span></button>
    </div>
    {travelling && <a className="journey-quote-source" href={SOURCE} target="_blank" rel="noreferrer">Testimonio de Pepa Rueda · Fuente ↗</a>}
    {reduced && <p className="journey-reduced">Movimiento reducido</p>}
    <div className="journey-progress" aria-hidden="true"><span data-progress /></div>
  </div>;
}
