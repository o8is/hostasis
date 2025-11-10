/*
 * o8 Background Animation
 * WebGL background effect for all o8 projects
 *
 * Usage:
 * 1. Add a canvas element with id="bgCanvas" to your HTML
 * 2. Include this script in your HTML
 */

(function() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) {
        console.warn('o8-background: Canvas element with id="bgCanvas" not found');
        return;
    }

    const gl = canvas.getContext('webgl');
    if (!gl) {
        console.warn('o8-background: WebGL not supported');
        return;
    }

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function compileShader(source, type) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
    }

    const vertexShaderSource = `
        attribute vec2 position;
        void main() {
            gl_Position = vec4(position, 0.0, 1.0);
        }
    `;

    const fragmentShaderSource = `
        precision mediump float;
        uniform float time;
        uniform vec2 resolution;

        void main() {
            vec2 uv = gl_FragCoord.xy / resolution.xy;
            vec2 p = uv * 2.0 - 1.0;
            p.x *= resolution.x / resolution.y;

            float d1 = length(p - vec2(sin(time * 0.3) * 0.5, cos(time * 0.2) * 0.5));
            float d2 = length(p - vec2(cos(time * 0.4) * 0.5, sin(time * 0.3) * 0.5));
            float d3 = length(p - vec2(sin(time * 0.2) * 0.3, cos(time * 0.4) * 0.3));

            float intensity = 0.04 / d1 + 0.04 / d2 + 0.03 / d3;
            intensity = clamp(intensity, 0.0, 0.5);

            vec3 color = vec3(0.12, 0.12, 0.18) * intensity;
            gl_FragColor = vec4(color, 1.0);
        }
    `;

    const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    const vertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1,
    ]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const timeLocation = gl.getUniformLocation(program, 'time');
    const resolutionLocation = gl.getUniformLocation(program, 'resolution');

    function render(time) {
        time *= 0.001;

        gl.uniform1f(timeLocation, time);
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
})();
