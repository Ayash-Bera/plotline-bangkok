"use client";

import { useEffect, useRef } from "react";
import type { RuleSource, SiteData } from "@/lib/domain";
import { Icon } from "./icon";

export function SourcesDialog({ open, onClose, sources, site, focusId }: { open: boolean; onClose: () => void; sources: RuleSource[]; site: SiteData | null; focusId?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open && focusId) requestAnimationFrame(() => document.getElementById(`source-${focusId}`)?.scrollIntoView({ block: "center" }));
  }, [open, focusId]);
  return <dialog ref={dialog} className="sources-dialog" aria-labelledby="sources-heading" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">THE STUDY BASIS</span><h2 id="sources-heading">Sources & assumptions</h2></div><button className="icon-button" onClick={onClose} aria-label="Close sources"><Icon name="close" /></button></div>
    <div className="dialog-body">
      <div className="notice"><Icon name="info"/><p>This is a concept feasibility study, not permit approval. Confirm the land survey, current zoning, legal road width, access rights and applicable requirements with the Bangkok authorities and a licensed professional.</p></div>
      {sources.map(source => <article className="source-item" id={`source-${source.id}`} key={source.id}><span className="eyebrow">{source.clause}</span><h3>{source.title}</h3><p>{source.explanation}</p><a href={source.url} target="_blank" rel="noreferrer">Open source <Icon name="external" size={14}/></a></article>)}
      <article className="source-item"><span className="eyebrow">MAP & SITE CONTEXT</span><h3>Local context, with honest height estimates</h3><p>Background map: OpenFreeMap and OpenStreetMap contributors. The local site snapshot remains visible if background tiles are unavailable. Heights marked as estimates are approximate context, not survey measurements.</p>{site && <><p>Snapshot: {site.metadata.snapshot}. Source: {site.metadata.source}.</p><ul>{site.metadata.notes.map(note => <li key={note}>{note}</li>)}</ul></>}</article>
      <article className="source-item"><span className="eyebrow">MODEL LIMITATIONS</span><h3>A planning envelope, with a defined scope</h3><p>The model tests only the rules identified in the checks. Unverified road widths are scenario inputs. Open space is distinct from permeable open space. Floor plates are concept geometry, without detailed cores, parking, fire access, structure or unit planning. Unmodelled requirements remain unresolved.</p><p>The envelope is a conservative stepped display, sampled independently of proposed floors. Its step and vertical sampling underfill bound appear beside the map control. Every band uses its top-elevation section, including a final partial band at the study ceiling. This vertical bound applies to sampling of the modeled volume; horizontal differences depend on the restrictions and separate conservative setbacks still apply.</p><p>Parcel history and existing FAR allocation are unknown. Interior clear heights and the applicable roof-height datum are unverified. Floor-to-floor heights and the study height ceiling do not resolve these requirements. The assumed permeable area is reserved for tree planting, but qualifying planting layout and ground treatment remain unverified.</p></article>
    </div>
  </dialog>;
}
