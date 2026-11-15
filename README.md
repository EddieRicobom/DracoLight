# DracoLight

Um jogo de voo livre em uma cidade destrutível. Voe como um dragão oriental, atravesse prédios e suba até a estratosfera, sem inimigos ou barra de vida.

**[Jogar DracoLight](https://eddiericobom.github.io/DracoLight/)**

O jogo aceita teclado e mouse, controle com analógicos ou controles de toque em celulares. Os controles aparecem no menu inicial e, no celular, durante o voo.

Segure Shift ou o gatilho direito para impulsionar. Ao ultrapassar aproximadamente 343 m/s, o voo produz uma onda de choque e um estrondo. Para reconstruir a cidade, pause o jogo e selecione **Reconstruir cidade**.

Mergulhar aumenta continuamente a velocidade; frear ou interromper um mergulho muito rápido produz uma onda de impacto.

Escolha a tinta no menu inicial ou no menu de pausa (Esc). As cores escolhidas afetam os novos rastros, que desaparecem gradualmente após cerca de 15 segundos; use **Limpar tinta** para apagá-los antes.

Voe em círculos na mesma direção para formar um tornado de tinta. Continuar girando faz o tornado crescer e permanecer por mais tempo; a velocidade do voo influencia sua rotação.

Clique com o botão direito do mouse, pressione X no controle ou toque em **Tinta** para criar uma bola. Atravesse-a para lançar um meteoro com sua velocidade; ao alcançar o chão, ele destrói construções próximas.

## Executar localmente

Instale o Node.js, depois execute:

```sh
npm ci
npm run dev
```

Abra no navegador o endereço informado pelo Vite. Para gerar a versão de produção, use `npm run build`; os arquivos serão criados em `dist/`.

O GitHub Actions compila e publica automaticamente alterações em `main`. Nas configurações do repositório, o GitHub Pages deve estar configurado para usar **GitHub Actions** como fonte.


A cidade é um mundo individual: multiplayer é uma possibilidade futura e ainda não está implementado. Assets urbanos e texturas do Poly Haven são CC0; as fontes estão nos arquivos de créditos em `public/polyhaven` e `public/textures`.
