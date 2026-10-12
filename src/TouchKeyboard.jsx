import { useEffect, useRef, useState } from 'react'
import './TouchKeyboard.css'

const LETTER_ROWS = [
  '1234567890',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm@.-',
]

const SYMBOL_ROWS = [
  '1234567890',
  '!@#$%^&*()',
  '-_=+[]{}\\|',
  ';:\'",.<>/?',
]

function acceptsText(element) {
  return (
    element instanceof HTMLTextAreaElement ||
    (
      element instanceof HTMLInputElement &&
      ['text', 'password', 'email', 'search', 'tel', 'url']
        .includes(element.type)
    )
  ) && !element.disabled && !element.readOnly
}

export default function TouchKeyboard() {
  const [target, setTarget] = useState(null)
  const [shift, setShift] = useState(false)
  const [symbols, setSymbols] = useState(false)
  const keyboard = useRef(null)

  useEffect(() => {
    let blurTimer

    function onFocus(event) {
      if (acceptsText(event.target)) {
        setTarget(event.target)
        setShift(false)
        setSymbols(false)
      }
    }

    function onBlur() {
      clearTimeout(blurTimer)

      blurTimer = setTimeout(() => {
        setTarget((current) =>
          document.activeElement === current ? current : null,
        )
      }, 0)
    }

    function onPointerDown(event) {
      if (keyboard.current?.contains(event.target)) return
      if (acceptsText(event.target)) return
      setTarget(null)
    }

    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    document.addEventListener('pointerdown', onPointerDown)

    if (acceptsText(document.activeElement)) {
      setTarget(document.activeElement)
    }

    return () => {
      clearTimeout(blurTimer)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  useEffect(() => {
    document.body.classList.toggle('deskbuddy-keyboard-open', Boolean(target))

    const frame = target
      ? requestAnimationFrame(() => {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        })
      : null

    return () => {
      document.body.classList.remove('deskbuddy-keyboard-open')
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [target])

  function edit(text, backspace = false) {
    if (!target?.isConnected) {
      setTarget(null)
      return
    }

    const value = target.value
    let start = target.selectionStart ?? value.length
    const end = target.selectionEnd ?? start

    if (backspace && start === end && start > 0) {
      const previousCharacter = Array.from(value.slice(0, start)).at(-1)
      start -= previousCharacter?.length || 0
    }

    const next = value.slice(0, start) + text + value.slice(end)

    if (target.maxLength >= 0 && next.length > target.maxLength) return

    const prototype = target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype

    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
    setter.call(target, next)
    target.dispatchEvent(new Event('input', { bubbles: true }))

    target.focus({ preventScroll: true })

    try {
      target.setSelectionRange(start + text.length, start + text.length)
    } catch {
      // Email fields don't support selection ranges.
    }

    if (!backspace) setShift(false)
  }

  function close() {
    target?.blur()
    setTarget(null)
  }

  if (!target) return null

  const rows = symbols ? SYMBOL_ROWS : LETTER_ROWS

  return (
    <section
      ref={keyboard}
      className="touch-keyboard"
      aria-label="Touchscreen keyboard"
      onPointerDown={(event) => event.preventDefault()}
    >
      {rows.map((row, index) => (
        <div className="touch-keyboard-row" key={index}>
          {Array.from(row).map((character) => {
            const text = shift ? character.toUpperCase() : character

            return (
              <button
                type="button"
                key={character}
                onClick={() => edit(text)}
              >
                {text}
              </button>
            )
          })}
        </div>
      ))}

      <div className="touch-keyboard-row">
        <button
          type="button"
          aria-pressed={shift}
          onClick={() => setShift((enabled) => !enabled)}
        >
          Shift
        </button>

        <button
          type="button"
          onClick={() => setSymbols((enabled) => !enabled)}
        >
          {symbols ? 'ABC' : '#+='}
        </button>

        <button
          type="button"
          className="touch-keyboard-space"
          onClick={() => edit(' ')}
        >
          Space
        </button>

        <button
          type="button"
          aria-label="Backspace"
          onClick={() => edit('', true)}
        >
          ⌫
        </button>

        <button
          type="button"
          className="touch-keyboard-done"
          onClick={close}
        >
          Done
        </button>
      </div>
    </section>
  )
}