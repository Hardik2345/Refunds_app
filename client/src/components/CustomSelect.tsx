import { useState, useCallback, useMemo } from 'react';
import { Box, Popover, ActionList, Text, Icon, UnstyledButton } from '@shopify/polaris';
import { ChevronDownIcon } from '@shopify/polaris-icons';

interface Option {
  label: string;
  value: string;
}

interface CustomSelectProps {
  label?: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  fullWidth?: boolean;
}

export const CustomSelect = ({ 
  label, 
  options, 
  value, 
  onChange, 
  disabled, 
  placeholder = 'Select option',
  fullWidth = true
}: CustomSelectProps) => {
  const [active, setActive] = useState(false);

  const toggleActive = useCallback(() => setActive((prev) => !prev), []);

  const selectedOption = useMemo(() => 
    options.find(opt => opt.value === value), 
    [options, value]
  );

  const handleSelect = useCallback((newValue: string) => {
    onChange(newValue);
    setActive(false);
  }, [onChange]);

  const actionItems = useMemo(() => 
    options.map(opt => ({
      content: opt.label,
      onAction: () => handleSelect(opt.value),
      active: opt.value === value
    })),
    [options, value, handleSelect]
  );

  const activator = (
    <UnstyledButton 
      onClick={toggleActive} 
      disabled={disabled}
      style={{
        width: fullWidth ? '100%' : 'auto',
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        border: 'none',
        outline: 'none',
        background: 'none',
        padding: 0
      }}
    >
      <div
        style={{
          padding: '6px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          background: '#ffffff',
          border: '1px solid #e1e3e5',
          borderRadius: '8px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}
      >
        <Text as="span" variant="bodyMd" tone={!selectedOption ? 'subdued' : undefined}>
          <span style={{ whiteSpace: 'nowrap' }}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </Text>
        <div style={{ opacity: disabled ? 0.4 : 0.8, marginLeft: '8px', display: 'flex' }}>
          <Icon source={ChevronDownIcon} tone="subdued" />
        </div>
      </div>
    </UnstyledButton>
  );

  return (
    <div style={{ width: fullWidth ? '100%' : 'auto' }}>
      {label && (
        <Box paddingBlockEnd="100">
          <Text as="p" variant="bodySm" fontWeight="medium" tone="subdued">{label}</Text>
        </Box>
      )}
      <Popover
        active={active}
        activator={activator}
        onClose={toggleActive}
        fullWidth={fullWidth}
        autofocusTarget="none"
      >
        <ActionList items={actionItems} />
      </Popover>
    </div>
  );
};
