/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014, Jonas Havers <jonas.havers@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
var jDataView = require('jdataview');

/* global console, jDataView, ArrayBuffer */

var gifyParse = (function () {
    'use strict';
    var defaultDelay = 100;

    function getPaletteSize(palette) {
        return (3 * Math.pow(2, 1 + bitToInt(palette.slice(5, 8))));
    }

    function getBitArray(num) {
        var bits = [];
        for (var i = 7; i >= 0; i--) {
            bits.push(!!(num & (1 << i)) ? 1 : 0);
        }
        return bits;
    }

    function getDuration(duration) {
        return ((duration / 100) * 1000);
    }

    function bitToInt(bitArray) {
        return bitArray.reduce(function (s, n) {
            return s * 2 + n;
        }, 0);
    }

    function getSubBlockSize(view, pos) {
        var totalSize = 0;
        while (true) {
            var size = view.getUint8(pos + totalSize, true);
            if (size === 0) {
                totalSize++;
                break;
            }
            else {
                totalSize += size + 1;
            }
        }
        return totalSize;
    }

    function getImageTemplate() {
        return {
            localPalette: false,
            localPaletteSize: 0,
            interlace: false,
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            delay: 0,
            disposal: 0
        };
    }

    function getInfo(sourceArrayBuffer, quickPass) {
        var pos = 0, size = 0, paletteSize = 0, image;

        var info = {
            valid: false,
            globalPalette: false,
            globalPaletteSize: 0,
            loopCount: 0,
            height: 0,
            width: 0,
            animated: false,
            images: [],
            isBrowserDuration: false,
            duration: 0,
            durationIE: 0,
            durationSafari: 0,
            durationFirefox: 0,
            durationChrome: 0,
            durationOpera: 0
        };

        var view = new jDataView(sourceArrayBuffer);

        // needs to be at least 10 bytes long
        if (sourceArrayBuffer.byteLength < 10) {
            return info;
        }

        // GIF8
        if ((view.getUint16(0) != 0x4749) || (view.getUint16(2) != 0x4638)) {
            return info;
        }

        // get height/width
        info.height = view.getUint16(6, true);
        info.width = view.getUint16(8, true);

        // not that safe to assume, but good enough by this point
        info.valid = true;

        // parse global palette
        var unpackedField = getBitArray(view.getUint8(10, true));
        if (unpackedField[0]) {
            var globalPaletteSize = getPaletteSize(unpackedField);
            info.globalPalette = true;
            info.globalPaletteSize = (globalPaletteSize / 3);
            pos += globalPaletteSize;
        }
        pos += 13;

        while (true) {
            try {
                var block = view.getUint8(pos, true);

                switch (block) {
                    case 0x21: // EXTENSION BLOCK
                        var type = view.getUint8(pos + 1, true);

                        if (type === 0xF9) { // GRAPHICS CONTROL
                            var length = view.getUint8(pos + 2);
                            if (length === 4) {

                                var delay = getDuration(view.getUint16(pos + 4, true));

                                if (delay < 60 && !info.isBrowserDuration) {
                                    info.isBrowserDuration = true;
                                }

                                info.duration += delay;

                                // http://nullsleep.tumblr.com/post/16524517190/animated-gif-minimum-frame-delay-browser-compatibility
                                // this might be outdated
                                info.durationIE += (delay < 60) ? defaultDelay : delay;
                                info.durationSafari += (delay < 60) ? defaultDelay : delay;
                                info.durationChrome += (delay < 20) ? defaultDelay : delay;
                                info.durationFirefox += (delay < 20) ? defaultDelay : delay;
                                info.durationOpera += (delay < 20) ? defaultDelay : delay;

                                // set image delay
                                image = getImageTemplate();
                                image.delay = delay;

                                // set disposal method
                                var unpackedField = getBitArray(view.getUint8(pos + 3));
                                var disposal = unpackedField.slice(3, 6).join('');
                                image.disposal = parseInt(disposal, 2);

                                pos += 8;
                            }
                            else {
                                pos++;
                            }
                        }
                        else {
                            if (type === 0xFF) { // AEB
                                // get loop count
                                info.loopCount = view.getUint8(pos + 16, true);
                            }

                            // CEB, PTEB, ETC
                            pos += 2;
                            pos += getSubBlockSize(view, pos);
                        }
                        break;
                    case 0x2C: // IMAGE DESCRIPTOR
                        if (!image) {
                            image = getImageTemplate();
                        }
                        image.left = view.getUint16(pos + 1, true);
                        image.top = view.getUint16(pos + 3, true);
                        image.width = view.getUint16(pos + 5, true);
                        image.height = view.getUint16(pos + 7, true);

                        var unpackedField = getBitArray(view.getUint8(pos + 9, true));
                        if (unpackedField[0]) {
                            // local palette?
                            var localPaletteSize = getPaletteSize(unpackedField);
                            image.localPalette = true;
                            image.localPaletteSize = (localPaletteSize / 3);

                            pos += localPaletteSize;
                        }
                        if (unpackedField[1]) {
                            // interlaced?
                            image.interlace = true;
                        }

                        // add image & reset object
                        info.images.push(image);
                        image = null;

                        // set animated flag
                        if (info.images.length > 1 && !info.animated) {
                            info.animated = true;

                            // quickly bail if the gif has more than one image
                            if (quickPass) {
                                return info;
                            }
                        }

                        pos += 11;
                        pos += getSubBlockSize(view, pos);
                        break;
                    case 0x3B: // TRAILER BLOCK (THE END)
                        return info;
                    default: // UNKNOWN BLOCK (bad)
                        pos++;
                        break;
                }
            }
            catch (e) {
                info.valid = false;
                return info;
            }

            // this shouldn't happen, but if the trailer block is missing, we should bail at EOF
            if ((pos) >= sourceArrayBuffer.byteLength) {
                return info;
            }
        }

        return info;
    }

    return {
        /**
         * Parses the GIF information from the given ArrayBuffer and returns true if the GIF is animated.
         *
         * @param sourceArrayBuffer
         * @returns {boolean}
         */
        isAnimated: function (sourceArrayBuffer) {
            var info = getInfo(sourceArrayBuffer, true);
            return info.animated;
        },
        /**
         * Parses the GIF information from the given ArrayBuffer and creates an information object.
         *
         * @param sourceArrayBuffer
         * @returns {{valid: boolean, globalPalette: boolean, globalPaletteSize: number, loopCount: number, height: number, width: number, animated: boolean, images: Array, isBrowserDuration: boolean, duration: number, durationIE: number, durationSafari: number, durationFirefox: number, durationChrome: number, durationOpera: number}}
         */
        getInfo: function (sourceArrayBuffer) {
            return getInfo(sourceArrayBuffer, false);
        }
    };
})();

module.exports = gifyParse;