/**
 * The strip above the composer, holding its height whether or not the train is
 * drawn in it, so the engine starting or stopping never shifts the composer
 * beneath it. It is drawn while a turn is out with nothing said for it yet,
 * and stops as soon as an answer is on the transcript or the turn settles,
 * whichever comes first.
 *
 * The train is chuggernaut's own sprite, redrawn against the theme: not one
 * fill is stated here, each is a class `conversation.css` fills from a token,
 * so the engine inverts with the page rather than staying dark on a dark one.
 * Contrast carries the shading where lightness cannot — `--ink-1` for what
 * frames the sprite and `--ink-3` for what recedes into it — because a token
 * ramp flips wholesale and an absolute highlight would not flip with it.
 *
 * Nothing here measures anything or holds a frame in state. The crossing, the
 * bounce, the wheels and the steam are each a keyframe, and a wheel turns about
 * its own axle through `transform-box: fill-box`: the served policy refuses a
 * `style` attribute, so the origin the sprite's author wrote inline is a share
 * of the wheel's own box here, and the same share for every wheel because every
 * wheel is the same drawing moved along the frame.
 */

import type { ReactNode } from "react";

import "./conversation.css";

/** Where each axle stands along the frame, in the sprite's own units. */
const waitingAxlesX: readonly number[] = [6, 13, 25, 36, 47];

function ConversationWaitingSteam(): ReactNode {
  return (
    <g className="conversation-waiting-steam">
      <path
        className="conversation-waiting-shade"
        d="M40 5h6v3h-6zM34 2h6v3h-6zM27 0h5v2h-5z"
      />
      <path
        className="conversation-waiting-mist"
        d="M40 5h4v1h-4zM34 2h4v1h-4z"
      />
    </g>
  );
}

function ConversationWaitingBody(): ReactNode {
  return (
    <g className="conversation-waiting-body">
      <path
        className="conversation-waiting-ink"
        d="M2 15h14v8H2zM0 21h20v3H0z"
      />
      <path className="conversation-waiting-boiler" d="M3 16h12v5H3z" />
      <path className="conversation-waiting-boiler-light" d="M3 16h12v1H3z" />
      <path
        className="conversation-waiting-ink"
        d="M4 13h3v-1h5v2h3v2H3v-2h1z"
      />
      <path
        className="conversation-waiting-shade"
        d="M6 13h3v1H6zM11 14h2v1h-2z"
      />
      <path
        className="conversation-waiting-ink"
        d="M19 8h17v3h-1v6h17v2h5v3h4v2H18V10h1z"
      />
      <path className="conversation-waiting-ink" d="M18 7h18v3H18z" />
      <path className="conversation-waiting-shade" d="M19 7h16v1H19z" />
      <path
        className="conversation-waiting-boiler"
        d="M21 10h12v11H21zM34 15h17v6H34z"
      />
      <path className="conversation-waiting-boiler-light" d="M34 14h15v2H34z" />
      <path
        className="conversation-waiting-boiler-dark"
        d="M34 19h17v2H34zM21 20h12v2H21z"
      />
      <path className="conversation-waiting-shade" d="M23 11h8v6h-8z" />
      <path className="conversation-waiting-glass" d="M24 11h6v4h-6z" />
      <path className="conversation-waiting-boiler-light" d="M24 11h2v2h-2z" />
      <path
        className="conversation-waiting-ink"
        d="M42 9h6v6h-6zM40 8h10v3H40z"
      />
      <path
        className="conversation-waiting-shade"
        d="M41 8h8v1h-8zM43 11h2v3h-2z"
      />
      <path className="conversation-waiting-gold" d="M36 13h4v8h-4z" />
      <path className="conversation-waiting-gilt" d="M36 13h1v7h-1z" />
      <path className="conversation-waiting-gold" d="M51 15h3v5h-3z" />
      <path className="conversation-waiting-gilt" d="M52 15h2v2h-2z" />
      <path className="conversation-waiting-beam" d="M19 21h36v2H19z" />
      <path className="conversation-waiting-beam-light" d="M20 21h34v1H20z" />
      <path className="conversation-waiting-ink" d="M55 20h2v2h2v2h3v1h-8z" />
    </g>
  );
}

function ConversationWaitingWheel(props: {
  readonly axleX: number;
}): ReactNode {
  const axleX = props.axleX;
  return (
    <>
      <path
        className="conversation-waiting-ink"
        d={`M${axleX - 3} 22h6v1h1v3h-1v1h-6v-1h-1v-3h1z`}
      />
      <path
        className="conversation-waiting-shade"
        d={`M${axleX - 2} 23h4v3h-4z`}
      />
      <g className="conversation-waiting-wheel">
        <path
          className="conversation-waiting-gold"
          d={`M${axleX} 22h1v3h-3v-1h2z`}
        />
      </g>
    </>
  );
}

function ConversationWaitingTrain(): ReactNode {
  return (
    <svg
      className="conversation-waiting-sprite"
      viewBox="0 0 64 28"
      shapeRendering="crispEdges"
    >
      <ConversationWaitingSteam />
      <ConversationWaitingBody />
      {waitingAxlesX.map((axleX) => (
        <ConversationWaitingWheel key={axleX} axleX={axleX} />
      ))}
      <path className="conversation-waiting-rod" d="M25 24h23v1H25z" />
    </svg>
  );
}

export function ConversationWaiting(props: {
  readonly waiting: boolean;
}): ReactNode {
  return (
    <div className="conversation-waiting">
      {props.waiting ? (
        <>
          <div className="conversation-waiting-track" aria-hidden="true" />
          <div
            className="conversation-waiting-engine"
            role="img"
            aria-label="chuggy is under way"
          >
            <ConversationWaitingTrain />
          </div>
        </>
      ) : null}
    </div>
  );
}
