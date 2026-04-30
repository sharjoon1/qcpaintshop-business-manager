/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './public/**/*.html',
        './public/**/*.js'
    ],
    safelist: [
        // Dynamic class patterns built in JS innerHTML strings.
        { pattern: /(bg|text|border)-(red|green|blue|yellow|amber|orange|gray|slate|emerald|teal|indigo|purple|pink|rose)-(50|100|200|300|400|500|600|700|800|900)/ },
        { pattern: /(bg|text|border)-(white|black)/ },
        { pattern: /(rounded|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-(0|1|2|3|4|5|6|8|10|12|16|20)/ },
        { pattern: /(text|font)-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)/ },
        { pattern: /(font)-(thin|light|normal|medium|semibold|bold|extrabold|black)/ },
        { pattern: /grid-cols-(1|2|3|4|5|6|7|8|9|10|11|12)/ },
        { pattern: /(w|h)-(1|2|3|4|5|6|8|10|12|16|20|24|32|40|48|56|64|72|80|96|full|screen|auto)/ },
        // Brand-specific arbitrary values used in templates.
        'bg-[#1B5E3B]', 'bg-[#154D31]', 'bg-[#0D3D23]',
        'bg-[#667eea]', 'bg-[#764ba2]', 'bg-[#6366F1]',
        'bg-[#D4A24E]',
        'text-[#1B5E3B]', 'text-[#D4A24E]', 'text-[#667eea]'
    ],
    theme: {
        extend: {
            colors: {
                qcgreen: {
                    DEFAULT: '#1B5E3B',
                    dark: '#154D31',
                    darker: '#0D3D23'
                },
                qcgold: '#D4A24E',
                admin: {
                    primary: '#667eea',
                    secondary: '#764ba2',
                    accent: '#6366F1'
                }
            }
        }
    },
    plugins: []
};
