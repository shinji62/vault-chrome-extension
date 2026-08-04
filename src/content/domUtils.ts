/**
 * Set value on an input and fire input + change events so that
 * React / Vue / Angular form bindings update their internal state.
 */
export function setNativeValue(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(field, value);
  } else {
    field.value = value;
  }
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}
