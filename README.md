# DracoLight

Um jogo de voo livre em uma cidade destrutível. Voe como um dragão oriental, atravesse prédios e suba até a estratosfera, sem inimigos ou barra de vida.

**[Jogar DracoLight](https://eddiericobom.github.io/DracoLight/)**

O jogo aceita teclado e mouse ou controle com analógicos. Os controles aparecem no menu inicial.

Segure Shift ou o gatilho direito para impulsionar. Ao ultrapassar aproximadamente 343 m/s, o voo produz uma onda de choque e um estrondo. Para reconstruir a cidade, pause o jogo e selecione **Reconstruir cidade**.

Escolha a tinta no menu inicial ou no menu de pausa (Esc). As cores escolhidas afetam os novos rastros; use **Limpar tinta** para apagar as marcas. O jogo limita a quantidade de marcas e remove as mais antigas quando esse limite é atingido.

## Executar localmente

Instale o Node.js, depois execute:

```sh
npm ci
npm run dev
```

Abra no navegador o endereço informado pelo Vite. Para gerar a versão de produção, use `npm run build`; os arquivos serão criados em `dist/`.

O GitHub Actions compila e publica automaticamente alterações em `main`. Nas configurações do repositório, o GitHub Pages deve estar configurado para usar **GitHub Actions** como fonte.


A cidade é um mundo individual: multiplayer é uma possibilidade futura e ainda não está implementado. Assets urbanos e texturas do Poly Haven são CC0; as fontes estão nos arquivos de créditos em `public/polyhaven` e `public/textures`.
