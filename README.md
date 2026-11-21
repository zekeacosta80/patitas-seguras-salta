# Patitas Seguras Salta

Cada enlace NFC usa el parámetro `id`. La página consulta `chapitas/{id}` y muestra la ficha pública o el estado sin activar.

## Asignar una chapita

1. Pedile al titular que cree una cuenta desde la página y verifique su correo.
2. En Firebase Authentication, buscá la cuenta y copiá su UID. Verificá la titularidad de la chapita por un canal independiente del enlace público.
3. En Firestore, creá o actualizá el documento `chapitasPermisos/{id}` con el campo de tipo cadena `ownerUid` igual a ese UID. El ID debe ser el mismo del enlace NFC, incluidos los ceros iniciales.
4. El titular puede entrar con su cuenta y tocar **Comprobar acceso**. Para revocar el permiso, quitá la asignación desde una cuenta administrativa.

## Configuración de Firebase

Habilitá **Correo electrónico/contraseña** en Authentication. Para publicar las reglas de la base predeterminada, ejecutá `firebase deploy --only firestore:rules` desde este directorio con una sesión administrativa de Firebase CLI.

## Retirar los PIN de una base existente

1. Publicá una regla temporal que permita solo `get` en `chapitas/{id}`. El bloqueo de escrituras mantiene estable el conjunto de fichas durante el cambio.
2. Desde Cloud Shell, con autorización administrativa sobre el proyecto, ejecutá `python3 scripts/migrate-pins.py` para comprobar los campos y obtener un conteo. Si el resultado es correcto, ejecutá `python3 scripts/migrate-pins.py --apply` para retirar `pin` y verificar el resultado. El script conserva el documento y el ID y muestra únicamente conteos.
3. Con el conteo de documentos con PIN en cero, publicá `firestore.rules` y desplegá el cliente actualizado en el sitio que usan los enlaces NFC.
