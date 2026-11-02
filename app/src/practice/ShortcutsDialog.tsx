import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

const SHORTCUTS: [string[], string][] = [
  [['→', '↓', 'PgDn', 'Mezerník'], 'Další řádek nebo stránka'],
  [['←', '↑', 'PgUp'], 'Předchozí řádek nebo stránka'],
  [['P'], 'Poslechnout ukázku / zastavit'],
  [['L'], 'Zapnout nebo vypnout smyčku'],
  [['R'], 'Od začátku (nebo od začátku smyčky)'],
  [['H'], 'Přepnout ruce: obě → pravá → levá'],
  [['+', '−'], 'Větší / menší noty'],
  [['F'], 'Celá obrazovka'],
  [['?'], 'Tahle nápověda'],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Klávesové zkratky</DialogTitle>
          <DialogDescription>
            Pedál na otáčení stránek (AirTurn, PageFlip a podobné) posílá šipky nebo PgUp/PgDn — funguje
            bez nastavování. Kliknutím na notu začneš hrát odtud.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y">
          {SHORTCUTS.map(([keys, what]) => (
            <li key={what} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span>{what}</span>
              <span className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
