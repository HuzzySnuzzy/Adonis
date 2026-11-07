'use strict';
// Versienummer. Bij een release vult het bouwscript dit in vanuit de tag (bijv. v1.2.0 -> "1.2.0").
module.exports = process.env.WERKOPDRACHTEN_BUILD_VERSION || require('../package.json').version;
