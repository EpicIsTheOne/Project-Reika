export interface MascotAsset {
  id: string;
  label: string;
  kind: 'portrait' | 'sprite' | 'voice' | 'theme';
  status: 'placeholder' | 'planned' | 'ready';
}
