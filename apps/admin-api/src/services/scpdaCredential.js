'use strict';
// Keep existing four-digit readers compatible. New passwords are exact visible
// ASCII, 6–64 bytes, within bcrypt's input limit; do not trim or normalize.
function validScpdaCredential(value){
 return typeof value==='string'&&value.length<=64&&!/[^!-~]/.test(value)&&(/^[0-9]{4}$/.test(value)||value.length>=6);
}
module.exports={validScpdaCredential};
