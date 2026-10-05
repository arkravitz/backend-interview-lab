#!/bin/zsh -l
cd "${0:A:h}" || exit 1
printf '\nBackend Interview Lab\nKeep this window open while practicing.\nOpen the Local address printed below in your browser.\n\n'
npm run dev
