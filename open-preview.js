'use strict';
// Keep shared links and the selected device view when opening the repository root.
const destination = new URL('ui/', location.href);
destination.search = location.search;
location.replace(destination.href);
