/**
 * Pièces jointes d'un actif — « un actif se vérifie sur pièces, pas sur déclaration ».
 *
 * Deux sources, et deux seulement, servies par `assets/views.py::_row` :
 *   - `image`     : `CharField(max_length=500)` — un chemin ou une URL, jamais un
 *                   `ImageField` (cf. docstring de `assets/models.py`) ;
 *   - `documents` : `JSONField(default=list)` — écrit par le client via
 *                   `CLIENT_WRITABLE`. En pratique `AssetFormDialog.jsx` y pousse
 *                   une liste de chaînes (une ligne = une référence de preuve),
 *                   mais le champ est un JSON libre : rien ne garantit la forme.
 *
 * D'où la règle de ce composant : **aucune clé n'est devinée**. Une entrée qui
 * n'est pas une chaîne est rendue telle qu'elle arrive (`JSON.stringify`), comme
 * le fait déjà le formulaire client. Lire `doc.url` ou `doc.label` sur un objet
 * dont on ignore la forme, c'est exactement le `undefined` qui fait tomber un
 * écran ; on préfère afficher une référence brute que mentir sur son contenu.
 *
 * Une référence n'est présentée comme consultable que si elle ressemble
 * réellement à une adresse (`http(s)://`, `data:`, ou chemin absolu). Sinon
 * c'est une mention déclarative (« Titre foncier n° 4471/KIN ») : elle s'affiche,
 * mais l'écran dit clairement qu'elle n'est pas vérifiable en ligne.
 */
import React, { useEffect, useState } from 'react';

/** Une pièce, normalisée pour l'affichage — jamais enrichie. */
interface Piece {
  /** Libellé affiché : la chaîne servie, ou sa forme JSON brute. */
  label: string;
  /** Adresse consultable, `null` si la référence n'en est pas une. */
  href: string | null;
  /** L'adresse pointe-t-elle vers une image affichable en ligne ? */
  isImage: boolean;
  /** L'entrée servie n'était pas une chaîne — forme inattendue, signalée. */
  raw: boolean;
}

const URL_LIKE = /^(https?:\/\/|data:|blob:|\/)/i;
const IMAGE_LIKE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;

function toPiece(entry: unknown): Piece {
  if (typeof entry === 'string') {
    const value = entry.trim();
    const href = URL_LIKE.test(value) ? value : null;
    return {
      label: value,
      href,
      isImage: href !== null && (IMAGE_LIKE.test(value) || /^data:image\//i.test(value)),
      raw: false,
    };
  }
  // Forme inconnue : on la montre sans l'interpréter.
  let label: string;
  try {
    label = JSON.stringify(entry) ?? String(entry);
  } catch {
    label = String(entry);
  }
  return { label, href: null, isImage: false, raw: true };
}

/** Visionneuse plein écran d'une pièce image. */
const Lightbox: React.FC<{ src: string; label: string; onClose: () => void }> = ({
  src, label, onClose,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pièce jointe : ${label}`}
      className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-6"
      onClick={onClose}
    >
      <img
        src={src}
        alt={label}
        className="max-h-[80vh] max-w-full rounded-lg border border-white/20 object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="mt-3 flex items-center gap-3 text-sm">
        <span className="text-slate-200 break-all max-w-xl">{label}</span>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white shrink-0"
        >
          Ouvrir l'original
        </a>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white shrink-0"
        >
          Fermer
        </button>
      </div>
    </div>
  );
};

/** Vignette d'une pièce image, qui retombe en lien si le chargement échoue. */
const Thumb: React.FC<{ piece: Piece; onOpen: (p: Piece) => void }> = ({ piece, onOpen }) => {
  const [broken, setBroken] = useState(false);

  if (broken || !piece.href) {
    return (
      <a
        href={piece.href ?? undefined}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-sky-300 hover:bg-white/10 break-all"
      >
        {piece.label}
        {broken && <span className="text-amber-300/80 shrink-0">(image illisible)</span>}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(piece)}
      className="group relative rounded-lg overflow-hidden border border-white/10 hover:border-white/30 bg-black/30"
      title={piece.label}
    >
      <img
        src={piece.href}
        alt={piece.label}
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-28 w-40 object-cover group-hover:opacity-80 transition-opacity"
      />
      <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-slate-200 px-1.5 py-1 truncate text-left">
        {piece.label}
      </span>
    </button>
  );
};

/**
 * Panneau des preuves d'un actif.
 *
 * @param image     champ `image` servi par l'API (chaîne, éventuellement vide).
 * @param documents champ `documents` servi par l'API (`unknown[]` — forme libre).
 */
const AssetEvidence: React.FC<{ image: string; documents: unknown[] }> = ({
  image, documents,
}) => {
  const [open, setOpen] = useState<Piece | null>(null);

  const photo = image && image.trim() ? toPiece(image) : null;
  const pieces = (documents || []).map(toPiece);
  const all = photo ? [photo, ...pieces] : pieces;

  const viewable = all.filter((p) => p.href !== null);
  const declarative = all.filter((p) => p.href === null);
  const images = viewable.filter((p) => p.isImage);
  const links = viewable.filter((p) => !p.isImage);

  if (all.length === 0) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
        <span className="font-semibold">Aucune pièce jointe.</span>{' '}
        Ni photo ni référence de preuve n'accompagne cet actif : la déclaration
        n'est appuyée par rien. Un actif se vérifie sur pièces — constatez-le sur
        place ou demandez les preuves au client avant de trancher.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300">
        Pièces jointes — {all.length} élément(s)
        {photo && <span className="text-slate-500 font-normal"> · dont la photo principale</span>}
      </p>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((p, i) => (
            <Thumb key={`img-${i}-${p.label}`} piece={p} onOpen={setOpen} />
          ))}
        </div>
      )}

      {links.length > 0 && (
        <ul className="space-y-1">
          {links.map((p, i) => (
            <li key={`lnk-${i}-${p.label}`}>
              <a
                href={p.href ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sky-300 hover:underline break-all"
              >
                {p.label}
              </a>
            </li>
          ))}
        </ul>
      )}

      {declarative.length > 0 && (
        <div>
          <p className="text-[11px] text-slate-500 mb-1">
            Références déclaratives — non consultables en ligne, à confronter à l'original sur place :
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {declarative.map((p, i) => (
              <li
                key={`ref-${i}-${p.label}`}
                className="px-2 py-1 rounded bg-white/5 border border-white/10 text-[11px] text-slate-300 break-all"
              >
                {p.label}
                {p.raw && (
                  <span className="ml-1 text-amber-300/80">(forme inattendue, affichée brute)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && open.href && (
        <Lightbox src={open.href} label={open.label} onClose={() => setOpen(null)} />
      )}
    </div>
  );
};

export default AssetEvidence;
