'use strict';
// Versie en releasedatum van dit programma. Bij een release vult het bouwscript beide in;
// vanuit de broncode (npm start) is er geen releasedatum.
module.exports = {
  version: require('./version'),
  date: process.env.WERKOPDRACHTEN_BUILD_DATE || '',
};
