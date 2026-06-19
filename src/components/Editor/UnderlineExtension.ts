import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    underline: {
      /**
       * Toggle underline style
       */
      toggleUnderline: () => ReturnType
      /**
       * Set underline style
       */
      setUnderline: () => ReturnType
      /**
       * Unset underline style
       */
      unsetUnderline: () => ReturnType
    }
  }
}

export const Underline = Mark.create({
  name: 'underline',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  parseHTML() {
    return [
      {
        tag: 'u',
      },
      {
        style: 'text-decoration=underline',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['u', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  addCommands() {
    return {
      toggleUnderline:
        () =>
        ({ commands }) => {
          return commands.toggleMark(this.name)
        },
      setUnderline:
        () =>
        ({ commands }) => {
          return commands.setMark(this.name)
        },
      unsetUnderline:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-u': () => this.editor.commands.toggleUnderline(),
      'Mod-U': () => this.editor.commands.toggleUnderline(),
    }
  },
})
