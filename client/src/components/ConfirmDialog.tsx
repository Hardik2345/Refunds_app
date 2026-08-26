import type { ReactNode } from 'react';
import { Modal, Text, BlockStack } from '@shopify/polaris';

/**
 * Shared confirmation dialog so destructive actions never fall back to the
 * browser's native window.confirm(). Mirrors the "Confirm refund" modal in
 * AgentDashboard: primary action on the right, Cancel beside it.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      primaryAction={{
        content: confirmLabel,
        onAction: onConfirm,
        loading,
        destructive,
      }}
      secondaryActions={[{ content: cancelLabel, onAction: onCancel, disabled: loading }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {typeof message === 'string' ? <Text as="p">{message}</Text> : message}
          {children}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
