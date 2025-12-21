// js/mermaid-theme-vars.js
// Centralized base theme variables for Mermaid (flowchart-focused)
// Edit these values to tweak the site's Mermaid styling.

const MERMAID_BASE_THEME = {
  theme: 'base',
  // themeVariables list includes common and flowchart-specific variables
  themeVariables: {
    // Global
    darkMode: false,
    background: '#ff0000ff',
    fontFamily: 'trebuchet ms, verdana, arial',
    fontSize: '16px',
    textColor: '#333333',

    // Primary/secondary/tertiary
    primaryColor: '#ADD8E6',        // node background primary
    primaryTextColor: '#083049',    // text color used on primary nodes
    primaryBorderColor: '#7BA7C9',

    secondaryColor: '#81C784',
    secondaryTextColor: '#083049',
    secondaryBorderColor: '#4A9A58',

    tertiaryColor: '#ffffff',
    tertiaryTextColor: '#333333',
    tertiaryBorderColor: '#DDDDDD',

    // Flowchart-specific
    nodeBorder: '#7BA7C9',
    clusterBkg: '#FFFFDE',
    clusterBorder: '#AAA433',
    defaultLinkColor: '#333333',
    titleColor: '#333333',
    edgeLabelBackground: '#E8E8E8',
    nodeTextColor: '#083049',
    mainBkg: '#FFFFFF',

    // Notes / misc
    noteBkgColor: '#fff5ad',
    noteTextColor: '#333',
    noteBorderColor: '#E6C44B',

    // Error / debug
    errorBkgColor: '#fcc',
    errorTextColor: '#900',

    // Additional flow/style variables that may affect rendering
    lineColor: '#cccccc',
    labelBoxBkgColor: '#f7f7f7',
    labelBoxBorderColor: '#cccccc',

    // Pie / charts (kept generic)
    pie1: '#ADD8E6',
    pie2: '#81C784',
    pie3: '#FFD700',
    pie4: '#FFB6C1',

    // Class/sequence specific fallbacks
    classText: '#333333',
    actorBkg: '#E6E6FA',
    actorBorder: '#CCCCFF'
  }
};

export default MERMAID_BASE_THEME;